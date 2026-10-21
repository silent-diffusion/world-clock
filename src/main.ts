import type { City } from "./cities";
import { landPath } from "./map";
import { inTauri, loadSettings, onSettingsChanged } from "./settings";
import "./settings-page";
import { isDaylight, nightPath, sunPosition, type SunPosition } from "./sun";

// The map is drawn in a fixed 1000×405 coordinate space and scaled to the window by the SVG viewBox.
const WIDTH = 1000;
const HEIGHT = 405;
const RADIUS = 36;
// Visible latitudes: the far north and Antarctica are cropped, as in most world clocks.
const LAT_TOP = 84;
const LAT_SPAN = 146;

const scaleX = WIDTH / 360;
const scaleY = HEIGHT / LAT_SPAN;
// Maps (longitude, -latitude) onto map pixels.
const MAP_TRANSFORM = `matrix(${scaleX},0,0,${scaleY},${WIDTH / 2},${LAT_TOP * scaleY})`;

// Display options that aren't in Settings yet.
const display = { look: "auto", hour24: false };

let settings = loadSettings();
onSettingsChanged(() => {
  settings = loadSettings();
  render();
});

const svg = document.getElementById("map") as unknown as SVGSVGElement;
const land = landPath();

if (inTauri) setUpDesktop();
document.documentElement.dataset.look = display.look;

// ---- Clock / Settings views ----

const tabs = document.querySelectorAll<HTMLButtonElement>("[data-view]");
function showView(view: string): void {
  for (const tab of tabs) {
    const active = tab.dataset.view === view;
    tab.setAttribute("aria-selected", String(active));
    document.getElementById(`${tab.dataset.view}-view`)!.hidden = !active;
  }
}
tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view!)));

// ---- Auto-hiding top bar ----
// The window has no title bar. Ours slides down when the mouse reaches the top edge (or a keyboard user
// tabs into it) and slides away again shortly after the mouse moves down or leaves the window.

const bar = document.getElementById("app-bar")!;
const REVEAL_ZONE = 24; // px from the top of the window
let hideTimer: number | undefined;

function showBar(): void {
  clearTimeout(hideTimer);
  bar.classList.add("shown");
}

function scheduleHide(): void {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!bar.matches(":hover") && !bar.querySelector(":focus-visible")) bar.classList.remove("shown");
  }, 400);
}

document.addEventListener("mousemove", (event) => {
  if (event.clientY <= REVEAL_ZONE) showBar();
  else if (bar.classList.contains("shown") && event.clientY > bar.offsetHeight) scheduleHide();
});
document.documentElement.addEventListener("mouseleave", scheduleHide);
bar.addEventListener("focusin", showBar);
bar.addEventListener("focusout", scheduleHide);

async function setUpWindowControls(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  const maximize = document.getElementById("maximize")!;

  document.querySelector<HTMLElement>(".window-controls")!.hidden = false;
  document.getElementById("minimize")!.addEventListener("click", () => appWindow.minimize());
  maximize.addEventListener("click", () => appWindow.toggleMaximize());
  document.getElementById("close")!.addEventListener("click", () => appWindow.close());

  // Swap the maximize icon for a "restore" icon while the window is maximized.
  const square = maximize.innerHTML;
  const restore = `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
  const syncMaximize = async () => {
    const maximized = await appWindow.isMaximized();
    maximize.innerHTML = maximized ? restore : square;
    maximize.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
    maximize.title = maximized ? "Restore" : "Maximize";
  };
  appWindow.onResized(syncMaximize);
  syncMaximize();
}

// Loaded lazily so the browser preview (npm run dev) doesn't touch the Tauri plugins.
async function setUpDesktop(): Promise<void> {
  setUpWindowControls();

  const { scheduleUpdateChecks } = await import("./updates");
  scheduleUpdateChecks(() => settings.autoCheckUpdates);

  // Start at sign-in by default; after the first run, the setting is whatever the user chose.
  const FIRST_RUN_KEY = "world-clock.autostart-initialized";
  if (!localStorage.getItem(FIRST_RUN_KEY)) {
    const { enable } = await import("@tauri-apps/plugin-autostart");
    try {
      await enable();
      localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch (error) {
      console.warn("Couldn't turn on start at sign-in", error);
    }
  }
}

function project(lat: number, lon: number): [number, number] {
  return [(lon + 180) * scaleX, (LAT_TOP - lat) * scaleY];
}

function timeParts(date: Date, timeZone: string, hour24: boolean): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: hour24 ? "h23" : "h12",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { time: `${get("hour")}:${get("minute")}`, period: hour24 ? "" : get("dayPeriod").charAt(0) };
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function renderPin(city: City, now: Date, sun: SunPosition): string {
  const [x, y] = project(city.lat, city.lon);
  const { time, period } = timeParts(now, city.timeZone, display.hour24);
  const dot = isDaylight(city.lat, city.lon, sun)
    ? `<circle class="pin-day" cx="${x}" cy="${y}" r="8"/>`
    : `<circle class="pin-night" cx="${x}" cy="${y}" r="6.5"/>`;

  // Top-left (or top-right, for left-hand labels) corner of the two-line label block.
  let lx = x + 18;
  let top = y - 12;
  let anchor = "start";
  if (city.label === "left") {
    lx = x - 18;
    anchor = "end";
  } else if (city.label === "above") {
    lx = x - 10;
    top = y - 62;
  } else if (city.label === "below") {
    lx = x - 10;
    top = y + 16;
  }

  const periodSpan = period ? `<tspan class="period" dx="3">${period}</tspan>` : "";
  return `${dot}
    <text class="code" x="${lx}" y="${top + 17}" text-anchor="${anchor}">${escapeXml(city.code)}</text>
    <text class="time" x="${lx}" y="${top + 45}" text-anchor="${anchor}">${time}${periodSpan}</text>`;
}

function render(): void {
  const now = new Date();
  const sun = sunPosition(now);
  const label = settings.cities.map((c) => `${c.name} ${timeParts(now, c.timeZone, display.hour24).time}`).join(", ");
  svg.setAttribute("aria-label", `World clock: ${label}`);
  svg.innerHTML = `
    <defs>
      <clipPath id="card"><rect width="${WIDTH}" height="${HEIGHT}" rx="${RADIUS}"/></clipPath>
      <filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.4 1.1"/></filter>
    </defs>
    <g clip-path="url(#card)">
      <rect class="ocean" width="${WIDTH}" height="${HEIGHT}"/>
      <g transform="${MAP_TRANSFORM}">
        <path class="land" d="${land}" fill-rule="evenodd"/>
        <path class="night" d="${nightPath(sun)}" filter="url(#soft)"/>
      </g>
      <g class="pins">${settings.cities.map((c) => renderPin(c, now, sun)).join("")}</g>
    </g>
    <rect class="edge" x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="${RADIUS - 1}"/>`;
}

// Redraw whenever the minute changes. Checking often (rather than sleeping a full minute)
// keeps the clock right after the computer wakes from sleep.
let lastMinute = -1;
function tick(): void {
  const minute = Math.floor(Date.now() / 60000);
  if (minute !== lastMinute) {
    lastMinute = minute;
    render();
  }
}

tick();
setInterval(tick, 5000);
document.addEventListener("visibilitychange", tick);

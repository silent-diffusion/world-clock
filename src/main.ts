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
  // The offset badge is sized from its rendered text, which can't be measured while the map is hidden.
  if (view === "clock") render();
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

/** The calendar day (days since 1970) it is in a time zone at a given moment. */
function localDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86400000;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// ---- Time scrubbing ----
// Click a city to select it, then scroll (or use the arrow keys) to move time forward or back.
// Every city, and the day/night shading, then shows that moment instead of now.

const STEP_MINUTES = 15; // 15-minute steps also land on half- and quarter-hour time zones
const WHEEL_STEP = 100; // wheel distance per step: one mouse-wheel notch; touchpads add up smaller moves
const MAX_OFFSET_MINUTES = 7 * 24 * 60;

let selectedKey: string | null = null;
let offsetMinutes = 0;
let wheelDistance = 0;

const cityKey = (city: City) => `${city.name}|${city.lat}|${city.lon}`;

function select(key: string): void {
  selectedKey = key;
  render();
}

function clearSelection(): void {
  selectedKey = null;
  offsetMinutes = 0;
  wheelDistance = 0;
  render();
}

function shiftBy(minutes: number): void {
  offsetMinutes = Math.max(-MAX_OFFSET_MINUTES, Math.min(MAX_OFFSET_MINUTES, offsetMinutes + minutes));
  render();
}

/** "+4 hr", "−2 hr 30 min", "+45 min". */
function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const mins = Math.abs(minutes) % 60;
  if (hours === 0) return `${sign}${mins} min`;
  return mins ? `${sign}${hours} hr ${mins} min` : `${sign}${hours} hr`;
}

svg.addEventListener("click", (event) => {
  const pin = (event.target as Element).closest<SVGGElement>("[data-key]");
  if (!pin) {
    if (selectedKey) clearSelection();
    return;
  }
  if (pin.dataset.key === selectedKey) clearSelection();
  else select(pin.dataset.key!);
});

svg.addEventListener(
  "wheel",
  (event) => {
    if (!selectedKey) return;
    event.preventDefault();
    wheelDistance += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 33 : event.deltaY;
    const steps = Math.trunc(wheelDistance / WHEEL_STEP);
    if (steps === 0) return;
    wheelDistance -= steps * WHEEL_STEP;
    shiftBy(-steps * STEP_MINUTES); // scrolling up moves time forward
  },
  { passive: false },
);

// Pins are focusable buttons: Enter or Space selects one.
svg.addEventListener("keydown", (event) => {
  const pin = (event.target as Element).closest<SVGGElement>("[data-key]");
  if (pin && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    pin.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});

const KEY_STEPS: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 4, PageDown: -4 };

document.addEventListener("keydown", (event) => {
  if (!selectedKey || document.getElementById("clock-view")!.hidden) return;
  if (event.key === "Escape") {
    clearSelection();
  } else if (event.key in KEY_STEPS) {
    event.preventDefault();
    shiftBy(KEY_STEPS[event.key] * STEP_MINUTES);
  }
});

// ---- Drawing ----

// The ocean, coastlines and frame never change, so they are drawn once; the night shading, pins and
// offset badge are redrawn every minute and on every scroll step.
svg.innerHTML = `
  <defs>
    <clipPath id="card"><rect width="${WIDTH}" height="${HEIGHT}" rx="${RADIUS}"/></clipPath>
    <filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.4 1.1"/></filter>
  </defs>
  <g clip-path="url(#card)">
    <rect class="ocean" width="${WIDTH}" height="${HEIGHT}"/>
    <g transform="${MAP_TRANSFORM}">
      <path class="land" d="${land}" fill-rule="evenodd"/>
      <path id="night" class="night" filter="url(#soft)"/>
    </g>
    <g id="pins" class="pins"></g>
    <g id="offset-badge" class="badge" display="none">
      <rect class="badge-bg" rx="15"/>
      <text class="badge-text" x="${WIDTH / 2}" y="40" text-anchor="middle"></text>
    </g>
  </g>
  <rect class="edge" x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="${RADIUS - 1}"/>`;

const nightLayer = svg.querySelector<SVGPathElement>("#night")!;
const pinLayer = svg.querySelector<SVGGElement>("#pins")!;
const badge = svg.querySelector<SVGGElement>("#offset-badge")!;
const badgeBg = badge.querySelector<SVGRectElement>("rect")!;
const badgeText = badge.querySelector<SVGTextElement>("text")!;

function renderPin(city: City, now: Date, at: Date, sun: SunPosition): string {
  const [x, y] = project(city.lat, city.lon);
  const key = cityKey(city);
  const selected = key === selectedKey;
  const { time, period } = timeParts(at, city.timeZone, display.hour24);
  const dayChange = offsetMinutes ? localDay(at, city.timeZone) - localDay(now, city.timeZone) : 0;

  const dot = isDaylight(city.lat, city.lon, sun)
    ? `<circle class="pin-day" cx="${x}" cy="${y}" r="8"/>`
    : `<circle class="pin-night" cx="${x}" cy="${y}" r="6.5"/>`;
  const halo = selected ? `<circle class="halo" cx="${x}" cy="${y}" r="15"/>` : "";

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
  const daySpan = dayChange ? `<tspan class="day" dx="4">${dayChange > 0 ? "+" : "−"}${Math.abs(dayChange)}d</tspan>` : "";
  const spoken = `${city.name}, ${time}${period ? ` ${period}M` : ""}`;
  return `<g class="pin${selected ? " selected" : ""}" data-key="${escapeXml(key)}" tabindex="0" role="button" aria-pressed="${selected}" aria-label="${escapeXml(spoken)}">
    <circle class="hit" cx="${x}" cy="${y}" r="22"/>
    ${halo}${dot}
    <text class="code" x="${lx}" y="${top + 17}" text-anchor="${anchor}">${escapeXml(city.code)}</text>
    <text class="time" x="${lx}" y="${top + 45}" text-anchor="${anchor}">${time}${periodSpan}${daySpan}</text>
  </g>`;
}

function renderBadge(): void {
  if (!selectedKey) {
    badge.setAttribute("display", "none");
    return;
  }
  badgeText.innerHTML = offsetMinutes
    ? `<tspan class="badge-main">${formatOffset(offsetMinutes)}</tspan><tspan class="badge-hint" dx="12">Esc returns to now</tspan>`
    : `<tspan class="badge-hint">Scroll to change the time</tspan>`;
  badge.setAttribute("display", "inline");
  const box = badgeText.getBBox();
  badgeBg.setAttribute("x", String(box.x - 16));
  badgeBg.setAttribute("y", String(box.y - 6));
  badgeBg.setAttribute("width", String(box.width + 32));
  badgeBg.setAttribute("height", String(box.height + 12));
}

function render(): void {
  // Forget the selection if that city was removed in Settings.
  if (selectedKey && !settings.cities.some((c) => cityKey(c) === selectedKey)) {
    selectedKey = null;
    offsetMinutes = 0;
  }
  const now = new Date();
  const at = new Date(now.getTime() + offsetMinutes * 60000);
  const sun = sunPosition(at);

  nightLayer.setAttribute("d", nightPath(sun));
  pinLayer.classList.toggle("shifted", offsetMinutes !== 0);
  pinLayer.innerHTML = settings.cities.map((c) => renderPin(c, now, at, sun)).join("");
  renderBadge();

  const label = settings.cities.map((c) => `${c.name} ${timeParts(at, c.timeZone, display.hour24).time}`).join(", ");
  const when = offsetMinutes ? ` (${formatOffset(offsetMinutes)} from now)` : "";
  svg.setAttribute("aria-label", `World clock${when}: ${label}`);
  // Redrawing replaces the pins, so put keyboard focus back on the selected one.
  if (selectedKey) svg.querySelector<SVGGElement>(".pin.selected")?.focus({ preventScroll: true });
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

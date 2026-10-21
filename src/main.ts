import { DEFAULT_CITIES, type City } from "./cities";
import { landPath } from "./map";
import { isDaylight, nightPath, sunPosition, type SunPosition } from "./sun";

// The widget is drawn in a fixed 1000×405 coordinate space and scaled to the window by the SVG viewBox.
const WIDTH = 1000;
const HEIGHT = 405;
const RADIUS = 36;
// Visible latitudes: the far north and Antarctica are cropped, as in most world clocks.
const LAT_TOP = 84;
const LAT_SPAN = 146;

const scaleX = WIDTH / 360;
const scaleY = HEIGHT / LAT_SPAN;
// Maps (longitude, -latitude) onto widget pixels.
const MAP_TRANSFORM = `matrix(${scaleX},0,0,${scaleY},${WIDTH / 2},${LAT_TOP * scaleY})`;

interface Settings {
  look: "auto" | "ocean" | "midnight" | "frost";
  hour24: boolean;
}

const settings: Settings = { look: "auto", hour24: false };

const svg = document.getElementById("widget") as unknown as SVGSVGElement;
const land = landPath();

if (!("__TAURI_INTERNALS__" in window)) document.documentElement.classList.add("browser");
document.documentElement.dataset.look = settings.look;

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
  const { time, period } = timeParts(now, city.timeZone, settings.hour24);
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
  const label = DEFAULT_CITIES.map((c) => `${c.name} ${timeParts(now, c.timeZone, settings.hour24).time}`).join(", ");
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
      <g class="pins">${DEFAULT_CITIES.map((c) => renderPin(c, now, sun)).join("")}</g>
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

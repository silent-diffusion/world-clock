import type { Settings } from "../settings";
import { state } from "../state";
import { solarElevation, sunPosition, type SunPosition } from "../sun";
import { localMinutes, weekday } from "../time";
import { dayMark, escapeHtml, type Snapshot } from "./common";

const root = document.getElementById("day-view")!;
const WINDOW = 24 * 60; // the bars cover 12 hours either side of now
const STEP = 15;

const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

/** Parts of the bar (as fractions) that fall between two local times of day, given the local time now. */
function band(nowMinutes: number, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (const k of [-1440, 0, 1440]) {
    const a = Math.max(0, (WINDOW / 2 + from - nowMinutes + k) / WINDOW);
    const b = Math.min(1, (WINDOW / 2 + to - nowMinutes + k) / WINDOW);
    if (b > a) out.push([a, b]);
  }
  return out;
}

/** Parts of the bar when the sun is up, from sun positions sampled every 15 minutes. */
function daylight(lat: number, lon: number, suns: SunPosition[]): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  suns.forEach((sun, k) => {
    const up = solarElevation(lat, lon, sun) > 0;
    const last = k === suns.length - 1;
    if (up && start === null) start = k;
    if ((!up || last) && start !== null) {
      out.push([start / (suns.length - 1), k / (suns.length - 1)]);
      start = null;
    }
  });
  return out;
}

// Row clicks select a city; the shell handles them for every view through their data-key.
export function renderDay(snap: Snapshot, settings: Settings): void {
  const suns: SunPosition[] = [];
  for (let m = -WINDOW / 2; m <= WINDOW / 2; m += STEP) suns.push(sunPosition(new Date(snap.now.getTime() + m * 60_000)));

  const shiftAt = (WINDOW / 2 + state.offsetMinutes) / WINDOW;
  const showShift = snap.shifted && shiftAt >= 0 && shiftAt <= 1;

  const rows = snap.byZone
    .map((info) => {
      const { city } = info;
      const nowMinutes = localMinutes(snap.now, city.timeZone);
      const segments = daylight(city.lat, city.lon, suns)
        .map(([a, b]) => `<span class="daylight" style="left:${pct(a)};width:${pct(b - a)}"></span>`)
        .join("");
      const work = band(nowMinutes, settings.workStart, settings.workEnd)
        .map(([a, b]) => `<span class="work" style="left:${pct(a)};width:${pct(b - a)}"></span>`)
        .join("");
      // Local midnight inside the window, labelled with the day it starts.
      const midnights = [WINDOW / 2 + (1440 - nowMinutes), WINDOW / 2 - nowMinutes]
        .filter((m) => m >= 0 && m <= WINDOW)
        .map((m) => {
          const day = weekday(new Date(snap.now.getTime() + (m - WINDOW / 2 + 1) * 60_000), city.timeZone);
          return `<span class="midnight" style="left:${pct(m / WINDOW)}"></span><span class="midnight-label" style="left:${pct(m / WINDOW)}">${day}</span>`;
        })
        .join("");
      const mark = dayMark(info, snap.shifted);
      return `<button type="button" class="day-row${info.selected ? " selected" : ""}" data-key="${escapeHtml(info.key)}" aria-pressed="${info.selected}" aria-label="${escapeHtml(`${city.name}, ${info.clock}`)}">
        <span class="city-cell"><span class="code">${escapeHtml(city.code)}</span><span class="name">${escapeHtml(city.name)}</span></span>
        <span class="time-cell"><span class="big">${info.time}<span class="ap">${info.period}M</span></span><span class="mark">${mark}</span></span>
        <span class="bar">${segments}${work}${midnights}<span class="now-line" style="left:50%"></span>${showShift ? `<span class="shift-line" style="left:${pct(shiftAt)}"></span>` : ""}</span>
      </button>`;
    })
    .join("");

  root.innerHTML = `
    <div class="day-grid day-head"><span>CITY</span><span>TIME</span><span class="axis"><span style="left:0">−12 H</span><span style="left:50%;transform:translateX(-50%);color:var(--ink)">NOW</span><span style="right:0">+12 H</span></span></div>
    ${rows}
    <div class="legend">
      <span><span class="swatch" style="background:var(--day)"></span>Daylight</span>
      <span><span class="swatch" style="background:var(--night-bar);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.15)"></span>Night</span>
      <span><span class="swatch" style="border:1.5px solid rgba(244,247,255,0.55);height:11px"></span>Working hours</span>
    </div>`;
}

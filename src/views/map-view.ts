import { landPath } from "../map";
import { saveSettings, type Settings } from "../settings";
import { setState, state } from "../state";
import { nightPath, sunTimes } from "../sun";
import { clockText, duration, formatGap, nextClockChange, shortDate, startOfLocalDay, systemTimeZone, type ClockChange } from "../time";
import { dayMark, escapeHtml, mapX, mapY, type CityInfo, type Snapshot } from "./common";

// The map is drawn in a 1000×405 space (latitudes 84°N to 62°S) and stretched to the box, which keeps that ratio.
const WIDTH = 1000;
const HEIGHT = 405;
const scaleX = WIDTH / 360;
const scaleY = HEIGHT / 146;
// Maps (longitude, -latitude) onto map pixels.
const MAP_TRANSFORM = `matrix(${scaleX},0,0,${scaleY},${WIDTH / 2},${84 * scaleY})`;

const svg = document.getElementById("map") as unknown as SVGSVGElement;
const pins = document.getElementById("pins")!;
const details = document.getElementById("details")!;
const dateTags = document.getElementById("date-tags")!;
const alertBox = document.getElementById("clock-alert")!;

const ALERT_DAYS = 7;
const DISMISSED_KEY = "world-clock.dismissed-alert";
state.dismissedAlert = localStorage.getItem(DISMISSED_KEY) ?? "";

// The coastlines and glow never change, so they are drawn once; the rest is updated in place.
svg.innerHTML = `
  <defs>
    <pattern id="land-dots" width="1.8" height="1.8" patternUnits="userSpaceOnUse">
      <circle cx="0.9" cy="0.9" r="0.42" fill="#7a92c4"/>
    </pattern>
    <filter id="night-soft" x="-5%" y="-10%" width="110%" height="120%"><feGaussianBlur stdDeviation="2.2 1.8"/></filter>
    <radialGradient id="sun-glow"><stop offset="0" stop-color="#ffd27a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
  </defs>
  <g transform="${MAP_TRANSFORM}">
    <path d="${landPath()}" fill="url(#land-dots)" fill-rule="evenodd"/>
    <path id="night" fill="rgba(2, 5, 12, 0.64)" filter="url(#night-soft)"/>
  </g>
  <g id="date-boundary" display="none">
    <rect id="date-shade" y="0" height="${HEIGHT}" fill="rgba(185, 166, 255, 0.1)"/>
    <line id="date-line-mark" y1="0" y2="${HEIGHT}" stroke="rgba(185, 166, 255, 0.75)" stroke-width="1.5" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>
  </g>
  <circle id="sun-halo" r="26" fill="url(#sun-glow)"/>
  <circle id="sun-dot" r="3.5" fill="#ffd27a"/>`;

const night = svg.querySelector("#night")!;
const boundary = svg.querySelector("#date-boundary")!;
const shade = svg.querySelector("#date-shade")!;
const boundaryLine = svg.querySelector("#date-line-mark")!;
const sunHalo = svg.querySelector("#sun-halo")!;
const sunDot = svg.querySelector("#sun-dot")!;

let current: Settings;

// ---- Clock-change lookups are slow-ish (an hour-by-hour scan), so keep them for an hour. ----
const changeCache = new Map<string, { hour: number; change: ClockChange | null }>();
function upcomingChange(timeZone: string, now: Date, days: number): ClockChange | null {
  const hour = Math.floor(now.getTime() / 3_600_000);
  const key = `${timeZone}|${days}`;
  const cached = changeCache.get(key);
  if (cached && cached.hour === hour) return cached.change;
  const change = nextClockChange(timeZone, now, days);
  changeCache.set(key, { hour, change });
  return change;
}

function changeSentence(change: ClockChange): string {
  const direction = change.delta < 0 ? "go back" : "go forward";
  return `${direction} ${duration(Math.abs(change.delta)).replace("1 hr", "an hour")}`;
}

// ---- Interaction ----

pins.addEventListener("click", (event) => {
  const pin = (event.target as Element).closest<HTMLButtonElement>(".pin");
  if (!pin) return;
  event.stopPropagation();
  const key = pin.dataset.key!;
  if (state.selectedKey === key) setState({ selectedKey: null, offsetMinutes: 0, detailsOpen: false });
  else setState({ selectedKey: key, detailsOpen: current.extras.details });
});

details.addEventListener("click", (event) => {
  event.stopPropagation();
  if ((event.target as Element).closest(".close-details")) setState({ detailsOpen: false });
});

details.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (!input.classList.contains("note-input")) return;
  const city = current.cities.find((c) => `${c.name}|${c.lat}|${c.lon}` === input.dataset.key);
  if (!city) return;
  city.note = input.value.trim() || undefined;
  saveSettings(current);
});

alertBox.addEventListener("click", (event) => {
  if (!(event.target as Element).closest(".dismiss")) return;
  state.dismissedAlert = alertBox.dataset.id ?? "";
  localStorage.setItem(DISMISSED_KEY, state.dismissedAlert);
  setState({});
});

// ---- Drawing ----

function renderPin(info: CityInfo, snap: Snapshot, settings: Settings, reference: CityInfo | null): string {
  const { city } = info;
  const x = mapX(city.lon).toFixed(2);
  const y = mapY(city.lat).toFixed(2);

  let tag = "";
  const change = settings.extras.clockAlerts ? upcomingChange(city.timeZone, snap.now, ALERT_DAYS) : null;
  if (change) tag = `<span class="chip-tag change">↺ ${escapeHtml(shortDate(change.at, city.timeZone).replace(/^\w+ /, ""))}</span>`;
  else if (settings.extras.dimAsleep && info.asleep) tag = `<span class="chip-tag">ASLEEP</span>`;

  let main: string;
  if (settings.extras.relative) {
    const refOffset = reference ? reference.offset : snap.yourOffset;
    const isReference = reference ? reference.key === info.key : false;
    const gap = isReference ? "Selected" : formatGap(info.offset - refOffset);
    const refDay = reference ? reference.dayFromYou : 0;
    const otherDay = info.dayFromYou !== refDay ? `${info.weekday} · ` : "";
    main = `${escapeHtml(gap)}<span class="mark">${otherDay}${escapeHtml(info.clock)}</span>`;
  } else {
    const mark = dayMark(info, snap.shifted);
    main = `${info.time}<span class="ap">${info.period}</span>${mark ? `<span class="mark">${mark}</span>` : ""}`;
  }

  const classes = ["pin", `side-${city.label}`];
  if (info.selected) classes.push("selected");
  if (settings.extras.dimAsleep && info.asleep && !info.selected) classes.push("asleep");
  const spoken = `${city.name}, ${info.clock}${info.isDay ? "" : ", night"}`;
  return `<button type="button" class="${classes.join(" ")}" style="left:${x}%;top:${y}%" data-key="${escapeHtml(info.key)}" aria-pressed="${info.selected}" aria-label="${escapeHtml(spoken)}">
    <span class="dot ${info.isDay ? "day" : "night"}"></span>
    <span class="chip"><span class="chip-code">${escapeHtml(city.code)}${tag}</span><span class="chip-time">${main}</span></span>
  </button>`;
}

function renderDetails(info: CityInfo, snap: Snapshot): void {
  const { city } = info;
  const dayStart = startOfLocalDay(snap.shown, city.timeZone);
  const times = sunTimes(city.lat, city.lon, dayStart);
  const at = (d: Date | null) => (d ? clockText(d, city.timeZone) : "—");
  const until = (d: Date | null) => (d ? (d.getTime() - snap.shown.getTime()) / 60_000 : -1);

  let next: string;
  if (until(times.goldenHour) > 0) next = `Golden hour starts in ${duration(until(times.goldenHour))}, sunset in ${duration(until(times.sunset))}.`;
  else if (until(times.sunset) > 0) next = `Sunset in ${duration(until(times.sunset))}.`;
  else if (until(times.sunrise) > 0) next = `Sunrise in ${duration(until(times.sunrise))}.`;
  else if (times.sunrise || times.sunset) next = "The sun has set for today.";
  else next = info.isDay ? "The sun doesn't set here today." : "The sun doesn't rise here today.";

  const daylight = times.sunrise && times.sunset ? duration((times.sunset.getTime() - times.sunrise.getTime()) / 60_000) : "—";
  const golden = times.goldenHour && times.sunset ? `${at(times.goldenHour)}–${at(times.sunset)}` : "—";
  const change = upcomingChange(city.timeZone, snap.now, 120);
  const changeText = change
    ? `Clocks ${changeSentence(change)} on ${shortDate(change.at, city.timeZone)} (${change.fromText} → ${change.toText})`
    : "No clock changes here in the next few months";

  details.innerHTML = `
    <div class="details-head">
      <span><div class="details-name">${escapeHtml(city.name)}</div><div class="details-where">${escapeHtml([city.country, info.weekday].filter(Boolean).join(" · "))}</div></span>
      <span class="details-time">${escapeHtml(info.clock)}</span>
    </div>
    <dl class="facts">
      <div><dt>SUNRISE</dt><dd>${at(times.sunrise)}</dd></div>
      <div><dt>SUNSET</dt><dd>${at(times.sunset)}</dd></div>
      <div><dt>GOLDEN HOUR</dt><dd class="golden">${golden}</dd></div>
      <div><dt>DAYLIGHT</dt><dd>${daylight}</dd></div>
    </dl>
    <div class="details-next">${next}</div>
    <div class="details-change${change ? "" : " none"}">${escapeHtml(changeText)}</div>
    <label class="field">NOTE
      <input class="note-input" type="text" maxlength="80" placeholder="Add a note, like who you know here" data-key="${escapeHtml(info.key)}" value="${escapeHtml(city.note ?? "")}"/>
    </label>
    <button type="button" class="icon-button close-details" aria-label="Close details" style="position:absolute;top:6px;right:6px;width:28px;height:28px">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`;
  details.setAttribute("aria-label", `${city.name} details`);

  // Open beside the pin, flipping left or up near the right and bottom edges.
  const x = mapX(city.lon);
  const y = mapY(city.lat);
  details.style.left = x > 62 ? "" : `calc(${x}% + 22px)`;
  details.style.right = x > 62 ? `calc(${100 - x}% + 22px)` : "";
  details.style.top = y > 50 ? "" : `max(0px, calc(${y}% - 30px))`;
  details.style.bottom = y > 50 ? `calc(${100 - y}% - 30px)` : "";
}

function renderAlert(snap: Snapshot, settings: Settings): void {
  if (!settings.extras.clockAlerts) {
    alertBox.hidden = true;
    return;
  }
  // Group cities by the moment their clocks change, soonest first.
  const groups = new Map<number, { change: ClockChange; names: string[]; zone: string }>();
  for (const { city } of snap.cities) {
    const change = upcomingChange(city.timeZone, snap.now, ALERT_DAYS);
    if (!change) continue;
    const group = groups.get(change.at.getTime()) ?? { change, names: [], zone: city.timeZone };
    group.names.push(city.name);
    groups.set(change.at.getTime(), group);
  }
  const sorted = [...groups.values()].sort((a, b) => a.change.at.getTime() - b.change.at.getTime());
  const id = sorted.map((g) => g.change.at.toISOString()).join(",");
  if (!sorted.length || id === state.dismissedAlert) {
    alertBox.hidden = true;
    return;
  }
  const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);
  const [first, ...rest] = sorted;
  const lead = `<strong>Clocks ${changeSentence(first.change)} in ${escapeHtml(list(first.names))} on ${shortDate(first.change.at, first.zone)}</strong> (${first.change.fromText} → ${first.change.toText}).`;
  const more = rest.map((g) => ` ${escapeHtml(list(g.names))} ${g.names.length > 1 ? "follow" : "follows"} on ${shortDate(g.change.at, g.zone)}.`).join("");
  alertBox.dataset.id = id;
  alertBox.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b9a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>
    <span class="alert-text">${lead}${more}</span>
    <button type="button" class="icon-button dismiss" aria-label="Dismiss" title="Dismiss">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`;
  alertBox.hidden = false;
}

function renderDateBoundary(snap: Snapshot, settings: Settings): void {
  if (!settings.extras.dateBoundary) {
    boundary.setAttribute("display", "none");
    dateTags.hidden = true;
    return;
  }
  // Where it is local (solar) midnight right now. East of it, up to the date line, it's already the next day.
  const u = snap.shown.getUTCHours() * 60 + snap.shown.getUTCMinutes();
  const lon = u >= 720 ? (1440 - u) / 4 : -u / 4;
  const x = ((lon + 180) / 360) * WIDTH;
  shade.setAttribute("x", x.toFixed(1));
  shade.setAttribute("width", (WIDTH - x).toFixed(1));
  boundaryLine.setAttribute("x1", x.toFixed(1));
  boundaryLine.setAttribute("x2", x.toFixed(1));
  boundary.removeAttribute("display");

  const laterNoon = new Date(Date.UTC(snap.shown.getUTCFullYear(), snap.shown.getUTCMonth(), snap.shown.getUTCDate() + (u >= 720 ? 1 : 0), 12));
  const earlierNoon = new Date(laterNoon.getTime() - 86_400_000);
  const name = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
  const pct = ((lon + 180) / 360) * 100;
  dateTags.innerHTML = `<span class="date-tag earlier" style="left:${pct}%">${name(earlierNoon)} ←</span><span class="date-tag later" style="left:${pct}%">→ ${name(laterNoon)}</span>`;
  dateTags.hidden = false;
}

export function renderMap(snap: Snapshot, settings: Settings): void {
  current = settings;
  night.setAttribute("d", nightPath(snap.sun));
  const sx = ((snap.sun.lon + 180) / 360) * WIDTH;
  const sy = ((84 - snap.sun.lat) / 146) * HEIGHT;
  for (const el of [sunHalo, sunDot]) {
    el.setAttribute("cx", sx.toFixed(1));
    el.setAttribute("cy", sy.toFixed(1));
  }
  renderDateBoundary(snap, settings);
  renderAlert(snap, settings);

  const selected = snap.cities.find((c) => c.selected) ?? null;
  // Keep focus on a pin across redraws so keyboard scrubbing keeps working.
  const focusedKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".pin")?.dataset.key;
  pins.innerHTML = snap.cities.map((info) => renderPin(info, snap, settings, selected)).join("");
  if (focusedKey) pins.querySelector<HTMLElement>(`.pin[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });

  const showDetails = Boolean(selected && state.detailsOpen && settings.extras.details);
  // Don't rebuild the card while its note is being typed in.
  if (showDetails && !details.contains(document.activeElement)) renderDetails(selected!, snap);
  details.hidden = !showDetails;
  svg.setAttribute("aria-label", `World map at ${clockText(snap.shown, systemTimeZone)} your time`);
}

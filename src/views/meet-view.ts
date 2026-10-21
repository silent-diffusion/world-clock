import { cityKey } from "../cities";
import { saveSettings, type Settings } from "../settings";
import { clockText, duration, localMinutes, startOfLocalDay, systemTimeZone, weekday } from "../time";
import { escapeHtml, type Snapshot } from "./common";

const root = document.getElementById("meet-view")!;
const HOUR = 3_600_000;

let current: Settings;

root.addEventListener("click", (event) => {
  const target = event.target as Element;
  const remove = target.closest<HTMLButtonElement>("[data-remove]");
  if (remove) {
    current.meetCities = current.meetCities.filter((k) => k !== remove.dataset.remove);
    saveSettings(current);
    return;
  }
  const copy = target.closest<HTMLButtonElement>(".copy-times");
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.text ?? "").then(
      () => {
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy times"), 1500);
      },
      () => (copy.textContent = "Couldn't copy"),
    );
  }
});

root.addEventListener("change", (event) => {
  const select = event.target as HTMLSelectElement;
  if (!select.classList.contains("add-person") || !select.value) return;
  current.meetCities = [...current.meetCities, select.value];
  saveSettings(current);
});

/** "9a", "3p", or "5:30p" for a local time in minutes. */
function shortTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

export function renderMeet(snap: Snapshot, settings: Settings): void {
  current = settings;
  const chosen = settings.meetCities
    .map((key) => settings.cities.find((c) => cityKey(c) === key))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const others = settings.cities.filter((c) => !settings.meetCities.includes(cityKey(c)));

  const people = chosen
    .map((c) => `<span class="person">${escapeHtml(c.name)}<button type="button" data-remove="${escapeHtml(cityKey(c))}" aria-label="Remove ${escapeHtml(c.name)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>`)
    .join("");
  const add = others.length
    ? `<select class="add-person" aria-label="Add a city to the meeting"><option value="">+ Add city</option>${others.map((c) => `<option value="${escapeHtml(cityKey(c))}">${escapeHtml(c.name)}</option>`).join("")}</select>`
    : "";

  // One column per hour of your day today.
  const dayStart = startOfLocalDay(snap.now, systemTimeZone);
  const columns = Array.from({ length: 24 }, (_, k) => new Date(dayStart.getTime() + k * HOUR));
  const header = columns.map((moment, k) => `<span>${k % 3 === 0 ? shortTime(localMinutes(moment, systemTimeZone)) : ""}</span>`).join("");

  const working = columns.map(() => chosen.length > 0);
  const rows = chosen
    .map((city) => {
      const cells = columns
        .map((moment, k) => {
          const m = localMinutes(moment, city.timeZone);
          const isWork = m >= settings.workStart && m < settings.workEnd;
          const awake = m >= 7 * 60 && m < 23 * 60;
          if (!isWork) working[k] = false;
          const text = m < 60 ? weekday(moment, city.timeZone) : shortTime(m);
          return `<span class="cell ${isWork ? "work" : awake ? "awake" : "asleep"}">${text}</span>`;
        })
        .join("");
      return `<div class="meet-row person-row"><span class="meet-name"><strong>${escapeHtml(city.name)}</strong><span>Now ${escapeHtml(clockText(snap.now, city.timeZone))}</span></span>${cells}</div>`;
    })
    .join("");

  // Runs of consecutive hours where everyone is working; prefer the next one still to come today.
  const runs: [number, number][] = [];
  working.forEach((w, k) => {
    if (!w) return;
    if (runs.length && runs[runs.length - 1][1] === k) runs[runs.length - 1][1] = k + 1;
    else runs.push([k, k + 1]);
  });
  const nowFraction = localMinutes(snap.now, systemTimeZone) / 1440;
  const nowHour = nowFraction * 24;
  const upcoming = runs.find(([, end]) => end > nowHour);
  const best = upcoming ?? runs[0];

  let result: string;
  if (chosen.length < 2) {
    result = `<span class="text"><span class="eyebrow">MEETING FINDER</span><span class="main">Add at least two cities to compare their working hours.</span></span>`;
  } else if (!best) {
    result = `<span class="text"><span class="eyebrow">NO SHARED WORKING HOURS</span><span class="main">These cities' working hours never overlap.</span><span class="note">Try fewer cities, or longer working hours in Settings.</span></span>`;
  } else {
    const [k0, k1] = best;
    const isToday = Boolean(upcoming);
    const start = new Date(columns[k0].getTime() + (isToday ? 0 : 24 * HOUR));
    const end = new Date(start.getTime() + (k1 - k0) * HOUR);
    const lines = chosen.map((c) => `${clockText(start, c.timeZone)}–${clockText(end, c.timeZone)} ${c.name}`);
    const wait = (start.getTime() - snap.now.getTime()) / 60_000;
    const note = wait <= 0 ? "Happening now" : `${isToday ? "Today" : "Tomorrow"}, starting in ${duration(wait)}`;
    result = `<span class="text"><span class="eyebrow">EVERYONE IS WORKING · ${duration((k1 - k0) * 60).toUpperCase()}</span><span class="main">${escapeHtml(lines.join("  ·  "))}</span><span class="note">${note}</span></span>
      <button type="button" class="primary copy-times" data-text="${escapeHtml(lines.join("\n"))}">Copy times</button>`;
  }

  const overlay = best && chosen.length >= 2
    ? `<span class="overlap" style="left:calc(130px + (100% - 130px) * ${best[0] / 24});width:calc((100% - 130px) * ${(best[1] - best[0]) / 24})"></span>`
    : "";

  root.innerHTML = `
    <div class="meet-people"><span class="label">Meeting with</span>${people}${add}</div>
    <div class="meet-grid">
      <div class="meet-row head"><span>YOUR TIME</span>${header}</div>
      ${rows}
      ${overlay}
      <span class="meet-now" style="left:calc(130px + (100% - 130px) * ${nowFraction.toFixed(4)})"></span>
    </div>
    <div class="legend" style="padding:0">
      <span><span class="swatch" style="background:var(--day)"></span>Working hours</span>
      <span><span class="swatch" style="background:#26345a"></span>Awake</span>
      <span><span class="swatch" style="background:#141b2d;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12)"></span>Asleep</span>
      <span><span class="swatch" style="width:2px;height:12px;background:var(--amber)"></span>Now</span>
    </div>
    <div class="meet-result">${result}</div>`;
}

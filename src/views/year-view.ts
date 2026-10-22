import { cityKey } from "../cities";
import { saveSettings, type Settings } from "../settings";
import { setState, state } from "../state";
import { duration, formatGap, localDay, nextClockChange, startOfLocalDay, systemTimeZone, utcOffsetMinutes } from "../time";
import { clockChangeDays, dateOfDay, daysInYear, gapRuns, holidaysIn, type GapRun, type Holiday } from "../year";
import { escapeHtml, type Snapshot } from "./common";

// The Year view: a calendar of the year that marks the days your cities' clocks change, their public holidays,
// and the weeks when the gap between two of them isn't the usual one. Clicking a day shows it in every view.

const root = document.getElementById("year-view")!;
const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

let current: Settings;
/** The year on screen; null follows the day being shown. */
let viewYear: number | null = null;
/** Holidays by year (and cities), once loaded. */
const holidays = new Map<string, Map<number, Holiday[]>>();
const loading = new Set<string>();

/** First day of the week in the user's locale: 0 = Sunday, 1 = Monday. */
const weekStart = (() => {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // older engines: fall through
  }
  return 1;
})();

/** Your calendar date at a moment, as a year and a day of that year. */
function yourDate(moment: Date): { year: number; day: number } {
  const ms = localDay(moment, systemTimeZone) * DAY;
  const year = new Date(ms).getUTCFullYear();
  return { year, day: (ms - Date.UTC(year, 0, 1)) / DAY };
}

const format = (year: number, day: number, options: Intl.DateTimeFormatOptions) =>
  dateOfDay(year, day).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
const short = (year: number, day: number) => format(year, day, { weekday: "short", day: "numeric", month: "short" });

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

function holidaysFor(year: number): Map<number, Holiday[]> | undefined {
  const key = `${year}|${current.cities.map(cityKey).join(";")}`;
  const found = holidays.get(key);
  if (!found && !loading.has(key)) {
    loading.add(key);
    holidaysIn(current.cities, year)
      .then((map) => {
        holidays.set(key, map);
        setState({}); // redraw with them
      })
      .catch((error) => console.warn("Couldn't load holidays", error))
      .finally(() => loading.delete(key));
  }
  return found;
}

/** Everything marked in one year. */
function yearFacts(year: number, reference: string, referenceKey: string | null) {
  const changes = new Map<number, string[]>();
  for (const city of current.cities) {
    for (const day of clockChangeDays(city.timeZone, year)) changes.set(day, [...(changes.get(day) ?? []), city.name]);
  }
  const gaps = current.cities
    .filter((city) => cityKey(city) !== referenceKey)
    .map((city) => ({ city, runs: gapRuns(city.timeZone, reference, year) }));
  const odd = new Set<number>();
  for (const { runs } of gaps) for (const run of runs) if (run.unusual) for (let d = Math.max(0, run.from); d < run.to; d++) odd.add(d);
  return { changes, gaps, odd, holidays: holidaysFor(year) };
}

// ---- Interaction ----

root.addEventListener("click", (event) => {
  const target = event.target as Element;
  const day = target.closest<HTMLElement>(".year-day");
  if (day) {
    showDay(Number(day.dataset.year), Number(day.dataset.day));
    return;
  }
  const step = target.closest<HTMLElement>("[data-year-step]");
  if (step) {
    viewYear = (viewYear ?? yourDate(new Date(Date.now() + state.offsetMinutes * 60_000)).year) + Number(step.dataset.yearStep);
    setState({});
    return;
  }
  if (target.closest(".year-today")) {
    viewYear = null;
    setState({ offsetMinutes: 0 });
    return;
  }
  const mark = target.closest<HTMLElement>("[data-mark]");
  if (mark) {
    const id = mark.dataset.mark as keyof Settings["yearMarks"];
    current.yearMarks = { ...current.yearMarks, [id]: !current.yearMarks[id] };
    saveSettings(current);
  }
});

/** Moves every view to the same time of day on another date (or back to now for today). */
function showDay(year: number, day: number): void {
  viewYear = null;
  const now = new Date();
  const noon = Date.UTC(year, 0, 1 + day, 12);
  const target = new Date(noon - utcOffsetMinutes(systemTimeZone, new Date(noon)) * 60_000);
  const offsetMinutes = Math.round((startOfLocalDay(target, systemTimeZone).getTime() - startOfLocalDay(now, systemTimeZone).getTime()) / 60_000);
  setState({ offsetMinutes });
}

// ---- Drawing ----

function month(year: number, m: number, facts: ReturnType<typeof yearFacts>, today: { year: number; day: number }, shown: { year: number; day: number }): string {
  const first = (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / DAY;
  const days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, m, 1)).getUTCDay() - weekStart + 7) % 7;
  const letters = Array.from({ length: 7 }, (_, i) => {
    const weekday = (weekStart + i) % 7;
    return `<span class="year-wd${weekday === 0 || weekday === 6 ? " weekend" : ""}">${LETTERS[weekday]}</span>`;
  }).join("");
  const cells: string[] = Array.from({ length: lead }, () => `<span></span>`);
  for (let d = 0; d < days; d++) {
    const day = first + d;
    const weekday = (new Date(Date.UTC(year, m, d + 1)).getUTCDay() + 7) % 7;
    const change = current.yearMarks.changes ? facts.changes.get(day) : undefined;
    const holiday = current.yearMarks.holidays ? facts.holidays?.get(day) : undefined;
    const odd = current.yearMarks.gaps && facts.odd.has(day);
    const isToday = year === today.year && day === today.day;
    const isShown = state.offsetMinutes !== 0 && year === shown.year && day === shown.day;
    const classes = ["year-day"];
    if (year < today.year || (year === today.year && day < today.day)) classes.push("past");
    if (weekday === 0 || weekday === 6) classes.push("weekend");
    if (odd) classes.push("odd");
    if (isToday) classes.push("today");
    if (isShown) classes.push("shown");
    const notes = [
      change ? `Clocks change in ${list(change)}` : "",
      ...(holiday ?? []).map((h) => `${h.name}: ${list(h.cities)}`),
      odd ? "Gaps between your cities differ from usual" : "",
    ].filter(Boolean);
    const marks = (change ? `<span class="year-mark change"></span>` : "") + (holiday?.length ? `<span class="year-mark holiday"></span>` : "");
    cells.push(
      `<button type="button" class="${classes.join(" ")}" data-year="${year}" data-day="${day}" aria-pressed="${isShown}" ` +
        `aria-label="${escapeHtml([format(year, day, { weekday: "long", day: "numeric", month: "long" }), ...notes].join(". "))}"` +
        `${notes.length ? ` title="${escapeHtml(notes.join("\n"))}"` : ""}>` +
        `${d + 1}${marks ? `<span class="year-marks" aria-hidden="true">${marks}</span>` : ""}</button>`,
    );
  }
  // Always six weeks, so every month is the same height.
  while (cells.length < 42) cells.push(`<span></span>`);
  const isCurrent = year === today.year && m === new Date(Date.UTC(year, 0, 1 + today.day)).getUTCMonth();
  return `<section class="year-month${isCurrent ? " current" : ""}" aria-label="${MONTHS[m]} ${year}">
    <h3>${MONTHS[m].slice(0, 3).toUpperCase()}</h3>
    <div class="year-grid">${letters}${cells.join("")}</div>
  </section>`;
}

/** What happens on the shown day, the gaps that are unusual on it, and what's coming up. */
function panel(shown: { year: number; day: number }, today: { year: number; day: number }, reference: string, referenceName: string, referenceKey: string | null): string {
  const facts = yearFacts(shown.year, reference, referenceKey);
  const { year, day } = shown;
  const sections: string[] = [];

  // Clock changes, grouped by what happens and when ("go back an hour at 3:00 AM").
  const changing = current.cities.filter((c) => clockChangeDays(c.timeZone, year).includes(day));
  const groups = new Map<string, string[]>();
  for (const city of changing) {
    const change = nextClockChange(city.timeZone, dateOfDay(year, day - 1), 2);
    if (!change) continue;
    const text = `${change.delta < 0 ? "back" : "forward"} ${Math.abs(change.delta) === 60 ? "an hour" : duration(change.delta)} at ${change.fromText}`;
    groups.set(text, [...(groups.get(text) ?? []), city.name]);
  }
  if (groups.size) {
    sections.push(`<div><h4>CLOCKS CHANGE</h4>${[...groups]
      .map(([text, names]) => `<p class="year-item"><span class="year-dot change"></span><span><strong>${escapeHtml(list(names))}</strong> ${names.length > 1 ? "go" : "goes"} ${escapeHtml(text)}</span></p>`)
      .join("")}</div>`);
  }

  const todays = facts.holidays?.get(day) ?? [];
  if (todays.length) {
    sections.push(`<div><h4>HOLIDAYS</h4>${todays
      .map((h) => `<p class="year-item"><span class="year-dot holiday"></span><span><strong>${escapeHtml(h.name)}</strong> ${escapeHtml(list(h.cities))}</span></p>`)
      .join("")}</div>`);
  }

  const odd = facts.gaps
    .map(({ city, runs }) => ({ city, run: runs.find((r: GapRun) => r.unusual && r.from <= day && day < r.to) }))
    .filter((g): g is { city: (typeof g)["city"]; run: GapRun } => Boolean(g.run));
  if (odd.length) {
    const until = Math.max(...odd.map((g) => g.run.to));
    sections.push(`<div><h4>GAPS FROM ${escapeHtml(referenceName.toUpperCase())}</h4>${odd
      .map(({ city, run }) => `<p class="year-item year-gap"><span>${escapeHtml(city.name)}</span><span><strong>${formatGap(run.gap)}</strong> · usually ${formatGap(run.usual)}</span></p>`)
      .join("")}<p class="year-note">Until ${short(year, until)}. Meetings set in one city's time move by the difference in the other.</p></div>`);
  }

  if (!sections.length) sections.push(`<p class="year-note">No clock changes, holidays or unusual gaps in your cities on this day.</p>`);

  // The next few things after the shown day.
  const upcoming: { at: number; html: string }[] = [];
  for (const y of [year, year + 1]) {
    const f = y === year ? facts : yearFacts(y, reference, referenceKey);
    const base = (Date.UTC(y, 0, 1) - Date.UTC(year, 0, 1)) / DAY;
    for (const [d, names] of f.changes) {
      if (base + d > day && current.yearMarks.changes) upcoming.push({ at: base + d, html: `<span class="year-dot change"></span><span><strong>${short(y, d)}</strong> Clocks change in ${escapeHtml(list(names))}</span>` });
    }
    for (const [d, list_] of f.holidays ?? []) {
      if (base + d > day && current.yearMarks.holidays)
        for (const h of list_) upcoming.push({ at: base + d, html: `<span class="year-dot holiday"></span><span><strong>${short(y, d)}</strong> ${escapeHtml(h.name)}: ${escapeHtml(list(h.cities))}</span>` });
    }
  }
  upcoming.sort((a, b) => a.at - b.at);
  const coming = upcoming.slice(0, 3).map((u) => `<p class="year-item">${u.html}</p>`).join("");

  const away = (Date.UTC(year, 0, 1 + day) - Date.UTC(today.year, 0, 1 + today.day)) / DAY;
  const when = away === 0 ? "TODAY" : away === 1 ? "TOMORROW" : away === -1 ? "YESTERDAY" : away > 0 ? `IN ${away} DAYS` : `${-away} DAYS AGO`;
  const title = format(year, day, { weekday: "long", day: "numeric", month: "long", ...(year !== today.year ? { year: "numeric" } : {}) });
  return `<aside class="year-panel" aria-label="${escapeHtml(title)}">
    <div><div class="year-when${away ? " away" : ""}">${when}${away ? " · SHOWN IN EVERY VIEW" : ""}</div><div class="year-title-day">${escapeHtml(title)}</div></div>
    ${sections.join("")}
    ${coming ? `<div><h4>COMING UP</h4>${coming}</div>` : ""}
  </aside>`;
}

/** One row per city: how far ahead of the reference it is through the year, unusual weeks in violet. */
function strip(year: number, facts: ReturnType<typeof yearFacts>, referenceName: string, today: { year: number; day: number }, shown: { year: number; day: number }): string {
  const total = daysInYear(year);
  const pct = (d: number) => `${((Math.min(total, Math.max(0, d)) / total) * 100).toFixed(2)}%`;
  const rows = facts.gaps
    .map(({ city, runs }) => {
      const bars = runs
        .map((run) => {
          const width = (Math.min(total, run.to) - Math.max(0, run.from)) / total;
          const text = formatGap(run.gap);
          return `<span class="year-seg${run.unusual && current.yearMarks.gaps ? " unusual" : ""}" style="left:${pct(run.from)};width:${(width * 100).toFixed(2)}%" title="${escapeHtml(`${city.name} ${text}`)}">${width > 0.07 ? text : ""}</span>`;
        })
        .join("");
      return `<div class="year-strip-row"><span class="year-strip-name">${escapeHtml(city.name)}</span><span class="year-strip-track">${bars}</span></div>`;
    })
    .join("");
  const ticks = MONTHS.map((name, m) => `<span style="left:${pct((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / DAY)}">${name.slice(0, 3)}</span>`).join("");
  const line = (at: { year: number; day: number }, cls: string) =>
    at.year === year ? `<span class="${cls}" style="left:calc(var(--name-width) + (100% - var(--name-width)) * ${((at.day + 0.5) / total).toFixed(4)})"></span>` : "";
  return `<section class="year-strip" aria-label="Hours from ${escapeHtml(referenceName)} through ${year}">
    <h4>HOURS FROM ${escapeHtml(referenceName.toUpperCase())} THROUGH ${year}</h4>
    <div class="year-strip-body">
      <div class="year-ticks">${ticks}</div>
      ${rows || `<p class="year-note">Add another city to compare.</p>`}
      ${line(today, "year-line today")}${state.offsetMinutes ? line(shown, "year-line shown") : ""}
    </div>
  </section>`;
}

export function renderYear(snap: Snapshot, settings: Settings): void {
  current = settings;
  const today = yourDate(snap.now);
  const shown = yourDate(snap.shown);
  const year = viewYear ?? shown.year;
  const selected = snap.cities.find((c) => c.selected);
  const reference = selected?.city.timeZone ?? systemTimeZone;
  const referenceName = selected?.city.name ?? "your time";
  const referenceKey = selected?.key ?? null;
  const facts = yearFacts(year, reference, referenceKey);

  const toggle = (id: keyof Settings["yearMarks"], label: string, swatch: string) =>
    `<button type="button" class="year-toggle" data-mark="${id}" aria-pressed="${settings.yearMarks[id]}"><span class="${swatch}" aria-hidden="true"></span>${label}</button>`;
  const awayFromToday = year !== today.year || state.offsetMinutes !== 0;

  root.innerHTML = `
    <div class="year-head">
      <button type="button" class="icon-button" data-year-step="-1" aria-label="Previous year"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h2 class="year-number">${year}</h2>
      <button type="button" class="icon-button" data-year-step="1" aria-label="Next year"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
      ${awayFromToday ? `<button type="button" class="year-toggle year-today">Today</button>` : ""}
      <div class="year-toggles" role="group" aria-label="What to mark">
        ${toggle("changes", "Clock changes", "year-mark change")}
        ${toggle("holidays", "Holidays", "year-mark holiday")}
        ${toggle("gaps", "Gaps that differ", "year-swatch-odd")}
      </div>
    </div>
    <div class="year-calendar">
      <div class="year-months">${MONTHS.map((_, m) => month(year, m, facts, today, shown)).join("")}</div>
      <div class="legend">
        <span><span class="swatch year-swatch-today"></span>Today</span>
        <span><span class="swatch year-swatch-shown"></span>Shown in every view</span>
        <span><span class="year-mark change"></span>Clocks change</span>
        <span><span class="year-mark holiday"></span>Holiday in one of your cities</span>
        <span><span class="swatch year-swatch-odd"></span>Gaps between your cities differ from usual</span>
      </div>
    </div>
    <div class="year-bottom">
      ${strip(year, facts, referenceName, today, shown)}
      ${panel(shown, today, reference, referenceName, referenceKey)}
    </div>`;
}

/** The footer summary while the Year view is showing: what's coming up in the next six weeks. */
export function yearSummary(snap: Snapshot, settings: Settings): string {
  current = settings;
  const today = yourDate(snap.now);
  let changes = 0;
  let holidayDays = 0;
  for (const year of [today.year, today.year + 1]) {
    const base = (Date.UTC(year, 0, 1) - Date.UTC(today.year, 0, 1)) / DAY;
    const inWindow = (d: number) => base + d >= today.day && base + d < today.day + 42;
    const seen = new Set<number>();
    for (const city of settings.cities) for (const d of clockChangeDays(city.timeZone, year)) if (inWindow(d)) seen.add(d);
    changes += seen.size;
    for (const d of holidaysFor(year)?.keys() ?? []) if (inWindow(d)) holidayDays++;
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${plural(changes, "clock change")} · ${plural(holidayDays, "holiday")} in the next 6 weeks`;
}

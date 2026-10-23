import { cityKey } from "../cities";
import { saveSettings, type Settings } from "../settings";
import { clockText, duration, localDay, localMinutes, startOfLocalDay, systemTimeZone, utcOffsetMinutes, weekday } from "../time";
import { escapeHtml, replaceKeepingFocus, type Snapshot } from "./common";

const root = document.getElementById("meet-view")!;
const HOUR = 3_600_000;

let current: Settings;
/** Set when a choice made in one of the view's drop-downs needs a redraw while that drop-down still has focus. */
let redrawChoice = false;

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
    const show = (text: string) => {
      copy.textContent = text;
      setTimeout(() => (copy.textContent = "Copy times"), 1500);
    };
    navigator.clipboard?.writeText(copy.dataset.text ?? "").then(
      () => show("Copied"),
      () => show("Couldn't copy"),
    );
  }
});

root.addEventListener("change", (event) => {
  const select = event.target as HTMLSelectElement;
  redrawChoice = true;
  if (select.classList.contains("meet-sort-select")) {
    // Switching to Custom keeps the order on screen as the starting point.
    if (select.value === "custom") current.meetCities = shownOrder;
    current.meetSort = select.value as Settings["meetSort"];
    saveSettings(current);
    return;
  }
  if (!select.classList.contains("add-person") || !select.value) return;
  current.meetCities = [...current.meetCities, select.value];
  saveSettings(current);
});

// ---- Custom order: drag a row (or Alt+Up / Alt+Down on it) to move it ----

/** The cities' keys in the order they're shown. */
let shownOrder: string[] = [];

function moveRow(key: string, to: number): void {
  const order = shownOrder.filter((k) => k !== key);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, key);
  current.meetCities = order;
  current.meetSort = "custom";
  saveSettings(current);
}

let draggedRow: string | null = null;
root.addEventListener("dragstart", (event) => {
  const row = (event.target as Element).closest<HTMLElement>(".person-row");
  if (!row) return;
  draggedRow = row.dataset.key!;
  row.classList.add("dragging");
  event.dataTransfer?.setData("text/plain", draggedRow);
});
root.addEventListener("dragover", (event) => {
  const row = (event.target as Element).closest<HTMLElement>(".person-row");
  if (!row || !draggedRow) return;
  event.preventDefault();
  root.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  const rect = row.getBoundingClientRect();
  row.classList.add(event.clientY > rect.top + rect.height / 2 ? "drop-after" : "drop-before");
});
root.addEventListener("drop", (event) => {
  const row = (event.target as Element).closest<HTMLElement>(".person-row");
  if (!row || !draggedRow) return;
  event.preventDefault();
  const rect = row.getBoundingClientRect();
  let to = shownOrder.indexOf(row.dataset.key!) + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
  if (shownOrder.indexOf(draggedRow) < to) to -= 1; // removing the dragged row first shifts the rest up
  const key = draggedRow;
  draggedRow = null;
  moveRow(key, to);
});
root.addEventListener("dragend", () => {
  draggedRow = null;
  root.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((el) => el.classList.remove("dragging", "drop-before", "drop-after"));
});
root.addEventListener("keydown", (event) => {
  const row = (event.target as Element).closest<HTMLElement>(".person-row");
  if (!row || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
  event.preventDefault();
  event.stopPropagation();
  const key = row.dataset.key!;
  moveRow(key, shownOrder.indexOf(key) + (event.key === "ArrowUp" ? -1 : 1));
  root.querySelector<HTMLElement>(`.person-row[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
});

/** "9a", "3p", or "5:30p" for a local time in minutes. */
function shortTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

export function renderMeet(snap: Snapshot, settings: Settings): void {
  current = settings;
  // Don't rebuild a drop-down out from under the user (the minute tick would close it), unless it was just changed.
  const active = document.activeElement;
  if (!redrawChoice && active instanceof HTMLSelectElement && root.contains(active)) return;
  redrawChoice = false;
  const chosen = settings.meetCities
    .map((key) => settings.cities.find((c) => cityKey(c) === key))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (settings.meetSort === "time") {
    // Earliest local time first (west to east), like the Day view.
    const offsets = new Map(chosen.map((c) => [c, utcOffsetMinutes(c.timeZone, snap.shown)]));
    chosen.sort((a, b) => offsets.get(a)! - offsets.get(b)! || a.lon - b.lon);
  } else if (settings.meetSort === "name") {
    chosen.sort((a, b) => a.name.localeCompare(b.name));
  }
  shownOrder = chosen.map(cityKey);
  const sort = `<label class="sort meet-sort"><span>Sort by</span><select id="meet-sort-select" class="meet-sort-select" aria-label="Order of the cities">
    ${[["time", "Time (earliest first)"], ["name", "Name (A–Z)"], ["custom", "Custom (drag rows)"]]
      .map(([value, text]) => `<option value="${value}"${value === settings.meetSort ? " selected" : ""}>${text}</option>`)
      .join("")}
  </select></label>`;
  const others = settings.cities.filter((c) => !settings.meetCities.includes(cityKey(c)));

  const people = chosen
    .map((c) => `<span class="person">${escapeHtml(c.name)}<button type="button" data-remove="${escapeHtml(cityKey(c))}" aria-label="Remove ${escapeHtml(c.name)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>`)
    .join("");
  const add = others.length
    ? `<select id="meet-add-person" class="add-person" aria-label="Add a city to the meeting"><option value="">+ Add city</option>${others.map((c) => `<option value="${escapeHtml(cityKey(c))}">${escapeHtml(c.name)}</option>`).join("")}</select>`
    : "";

  // One column per hour of your day, on the day being shown.
  const dayStart = startOfLocalDay(snap.shown, systemTimeZone);
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
      return `<div class="meet-row person-row" role="listitem" draggable="true" tabindex="0" data-key="${escapeHtml(cityKey(city))}" aria-label="${escapeHtml(city.name)}. Drag, or press Alt+Up or Alt+Down, to reorder."><span class="meet-name"><span class="grip" aria-hidden="true"></span><span><strong>${escapeHtml(city.name)}</strong><span>${snap.shifted ? "" : "Now "}${escapeHtml(clockText(snap.shown, city.timeZone))}</span></span></span>${cells}</div>`;
    })
    .join("");

  // Runs of consecutive hours where everyone is working; prefer the next one still to come today.
  const runs: [number, number][] = [];
  working.forEach((w, k) => {
    if (!w) return;
    if (runs.length && runs[runs.length - 1][1] === k) runs[runs.length - 1][1] = k + 1;
    else runs.push([k, k + 1]);
  });
  const nowFraction = localMinutes(snap.shown, systemTimeZone) / 1440;
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
    // A city whose slot falls on a different day from yours gets that day's name.
    const otherDay = (timeZone: string) => (localDay(start, timeZone) !== localDay(start, systemTimeZone) ? `${weekday(start, timeZone)} ` : "");
    const lines = chosen.map((c) => `${otherDay(c.timeZone)}${clockText(start, c.timeZone)}–${clockText(end, c.timeZone)} ${c.name}`);
    const wait = (start.getTime() - snap.shown.getTime()) / 60_000;
    let note: string;
    if (wait <= 0) note = snap.shifted ? "Happening at the time shown" : "Happening now";
    else if (snap.shifted) note = `${isToday ? "That day" : "The day after"}, ${duration(wait)} after the time shown`;
    else note = `${isToday ? "Today" : "Tomorrow"}, starting in ${duration(wait)}`;
    result = `<span class="text"><span class="eyebrow">EVERYONE IS WORKING · ${duration((k1 - k0) * 60).toUpperCase()}</span><span class="main">${escapeHtml(lines.join("  ·  "))}</span><span class="note">${note}</span></span>
      <button type="button" id="meet-copy" class="primary copy-times" data-text="${escapeHtml(lines.join("\n"))}">Copy times</button>`;
  }

  const overlay = best && chosen.length >= 2
    ? `<span class="overlap" style="left:calc(130px + (100% - 130px) * ${best[0] / 24});width:calc((100% - 130px) * ${(best[1] - best[0]) / 24})"></span>`
    : "";

  replaceKeepingFocus(root, `
    <div class="meet-people"><span class="label">Meeting with</span>${people}${add}${sort}</div>
    <div class="meet-grid">
      <div class="meet-row head"><span>YOUR TIME</span>${header}</div>
      <div class="meet-list" role="list" aria-label="Cities in the meeting">${rows}</div>
      ${overlay}
      <span class="meet-now" style="left:calc(130px + (100% - 130px) * ${nowFraction.toFixed(4)})"></span>
    </div>
    <div class="legend" style="padding:0">
      <span><span class="swatch" style="background:var(--day)"></span>Working hours</span>
      <span><span class="swatch" style="background:#26345a"></span>Awake</span>
      <span><span class="swatch" style="background:#141b2d;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12)"></span>Asleep</span>
      <span><span class="swatch" style="width:2px;height:12px;background:var(--pin)"></span>${snap.shifted ? "Time shown" : "Now"}</span>
    </div>
    <div class="meet-result">${result}</div>`);
}

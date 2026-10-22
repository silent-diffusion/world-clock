import { cityKey, defaultLabelSide, makeCode, type City, type LabelSide } from "./cities";
import { inTauri, loadSettings, saveSettings, VIEW_INFO, type CitySort, type MapExtras, type Settings, type ViewId } from "./settings";
import { clockText, utcOffsetMinutes } from "./time";

interface CityRecord {
  city: string;
  city_ascii: string;
  lat: number;
  lng: number;
  pop: number;
  country: string;
  province: string;
  timezone: string;
}

const LABEL_SIDES: { value: LabelSide; text: string }[] = [
  { value: "right", text: "Label right" },
  { value: "left", text: "Label left" },
  { value: "above", text: "Label above" },
  { value: "below", text: "Label below" },
];

const EXTRAS: { id: keyof MapExtras; name: string; description: string }[] = [
  { id: "dateBoundary", name: "Show where it's already tomorrow", description: "Shades the part of the world past midnight and names both days" },
  { id: "dimAsleep", name: "Dim cities where people are asleep", description: "Between 11 PM and 7 AM local time" },
  { id: "relative", name: "Times relative to the selected city", description: "Labels show “+6h” instead of the clock time" },
  { id: "details", name: "City details on click", description: "Sunrise, sunset, golden hour, clock changes and your note" },
  { id: "clockAlerts", name: "Warn before clocks change", description: "A heads-up a week before daylight saving starts or ends" },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewList = $<HTMLUListElement>("view-list");
const extrasList = $<HTMLDivElement>("extras-list");
const workStart = $<HTMLSelectElement>("work-start");
const workEnd = $<HTMLSelectElement>("work-end");
const miniPinned = $<HTMLInputElement>("mini-pinned");
const wallpaperOn = $<HTMLInputElement>("wallpaper-on");
const wallpaperView = $<HTMLSelectElement>("wallpaper-view");
const wallpaperStatus = $<HTMLSpanElement>("wallpaper-status");
const cityList = $<HTMLUListElement>("city-list");
const search = $<HTMLInputElement>("city-search");
const results = $<HTMLUListElement>("search-results");
const autostart = $<HTMLInputElement>("autostart");
const autoUpdates = $<HTMLInputElement>("auto-updates");
const version = $<HTMLSpanElement>("version");
const updateStatus = $<HTMLSpanElement>("update-status");
const checkNow = $<HTMLButtonElement>("check-now");
const install = $<HTMLButtonElement>("install");
const citySort = $<HTMLSelectElement>("city-sort");

let settings: Settings = loadSettings();
let matches: CityRecord[] = [];

function escapeHtml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function update(change: (s: Settings) => void, rerender: () => void = () => {}): void {
  change(settings);
  saveSettings(settings);
  rerender();
}

function timeOption(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// ---- Views: on/off and drag to reorder ----

function renderViews(): void {
  viewList.innerHTML = settings.views
    .map(({ id, on }) => {
      const info = VIEW_INFO[id];
      const locked = id === "map";
      return `<li class="row view-row" draggable="true" data-id="${id}">
        <span class="handle" aria-hidden="true" title="Drag to reorder"></span>
        <span class="row-text"><span class="row-title">${info.name}</span><span class="row-sub">${info.description}</span></span>
        <input type="checkbox" role="switch" class="switch" data-view="${id}" aria-label="Show the ${info.name} view (Alt+Up or Alt+Down moves it)"${on ? " checked" : ""}${locked ? " disabled" : ""}/>
      </li>`;
    })
    .join("");
}

/** Moves a view so it ends up at `toIndex` in the list. */
function moveView(id: ViewId, toIndex: number): void {
  update((s) => {
    const from = s.views.findIndex((v) => v.id === id);
    const [item] = s.views.splice(from, 1);
    s.views.splice(Math.max(0, Math.min(s.views.length, toIndex)), 0, item);
  }, renderViews);
}

viewList.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const id = input.dataset.view as ViewId;
  update((s) => (s.views.find((v) => v.id === id)!.on = input.checked));
});

// Keyboard reordering: Alt+Up / Alt+Down on a view's switch.
viewList.addEventListener("keydown", (event) => {
  const input = event.target as HTMLInputElement;
  if (!event.altKey || !input.dataset.view || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
  event.preventDefault();
  const id = input.dataset.view as ViewId;
  const index = settings.views.findIndex((v) => v.id === id);
  moveView(id, index + (event.key === "ArrowUp" ? -1 : 1));
  viewList.querySelector<HTMLInputElement>(`[data-view="${id}"]`)?.focus();
});

let draggedView: ViewId | null = null;

/** Where a drop over `row` would land: before it, or after it when over its lower half. */
function dropPosition(row: HTMLElement, clientY: number): "before" | "after" {
  const rect = row.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2 ? "after" : "before";
}

viewList.addEventListener("dragstart", (event) => {
  const row = (event.target as Element).closest<HTMLElement>(".view-row");
  if (!row) return;
  draggedView = row.dataset.id as ViewId;
  row.classList.add("dragging");
  event.dataTransfer?.setData("text/plain", draggedView);
});

viewList.addEventListener("dragover", (event) => {
  const row = (event.target as Element).closest<HTMLElement>(".view-row");
  if (!row || !draggedView) return;
  event.preventDefault();
  viewList.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  row.classList.add(`drop-${dropPosition(row, event.clientY)}`);
});

viewList.addEventListener("drop", (event) => {
  const row = (event.target as Element).closest<HTMLElement>(".view-row");
  if (!row || !draggedView) return;
  event.preventDefault();
  const from = settings.views.findIndex((v) => v.id === draggedView);
  let to = settings.views.findIndex((v) => v.id === row.dataset.id) + (dropPosition(row, event.clientY) === "after" ? 1 : 0);
  if (from < to) to -= 1; // removing the dragged row first shifts the rest up
  moveView(draggedView, to);
});

viewList.addEventListener("dragend", () => {
  draggedView = null;
  renderViews();
});

// ---- Map extras ----

function renderExtras(): void {
  extrasList.innerHTML = EXTRAS.map(
    (x) => `<label class="row">
      <span class="row-text"><span class="row-title">${x.name}</span><span class="row-sub">${x.description}</span></span>
      <input type="checkbox" role="switch" class="switch" data-extra="${x.id}"${settings.extras[x.id] ? " checked" : ""}/>
    </label>`,
  ).join("");
}

extrasList.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const id = input.dataset.extra as keyof MapExtras;
  update((s) => (s.extras[id] = input.checked));
});

// ---- Working hours and mini mode ----

function renderHours(): void {
  const starts = Array.from({ length: 15 }, (_, i) => 5 * 60 + i * 30); // 5:00 AM to 12:00 PM
  const ends = Array.from({ length: 23 }, (_, i) => 12 * 60 + i * 30); // 12:00 PM to 11:00 PM
  workStart.innerHTML = starts.map((m) => `<option value="${m}"${m === settings.workStart ? " selected" : ""}>${timeOption(m)}</option>`).join("");
  workEnd.innerHTML = ends.map((m) => `<option value="${m}"${m === settings.workEnd ? " selected" : ""}>${timeOption(m)}</option>`).join("");
}

workStart.addEventListener("change", () => update((s) => (s.workStart = Number(workStart.value))));
workEnd.addEventListener("change", () => update((s) => (s.workEnd = Number(workEnd.value))));
miniPinned.addEventListener("change", () => update((s) => (s.miniPinnedOnly = miniPinned.checked)));

// ---- Desktop background ----

function renderWallpaper(): void {
  wallpaperView.innerHTML = (Object.keys(VIEW_INFO) as ViewId[])
    .map((id) => `<option value="${id}"${id === settings.wallpaper.view ? " selected" : ""}>${VIEW_INFO[id].name}</option>`)
    .join("");
  wallpaperOn.checked = settings.wallpaper.on;
  if (!inTauri) {
    wallpaperOn.disabled = true;
    wallpaperStatus.textContent = "Available in the desktop app";
  } else {
    wallpaperStatus.textContent = settings.wallpaper.on ? "Updating every minute" : "Your own background stays until you turn this on";
  }
}

wallpaperOn.addEventListener("change", () => update((s) => (s.wallpaper.on = wallpaperOn.checked), renderWallpaper));
wallpaperView.addEventListener("change", () => update((s) => (s.wallpaper.view = wallpaperView.value as ViewId)));

// ---- Cities ----

/**
 * Indexes into settings.cities in display order. The saved list stays in the order cities were added,
 * so "Date added" is simply that order and the indexes stay valid for edits and removal.
 */
function displayOrder(): number[] {
  const order = settings.cities.map((_, i) => i);
  const cities = settings.cities;
  if (settings.citySort === "name") {
    order.sort((a, b) => cities[a].name.localeCompare(cities[b].name));
  } else if (settings.citySort === "timezone") {
    // West to east: earliest local time first; cities sharing an offset go by longitude.
    const offsets = cities.map((c) => utcOffsetMinutes(c.timeZone));
    order.sort((a, b) => offsets[a] - offsets[b] || cities[a].lon - cities[b].lon);
  }
  return order;
}

function renderCities(): void {
  if (settings.cities.length === 0) {
    cityList.innerHTML = `<li class="empty">No cities yet. Search below to add one.</li>`;
    return;
  }
  const now = new Date();
  cityList.innerHTML = displayOrder()
    .map((i) => {
      const city = settings.cities[i];
      const where = [city.country, city.timeZone.replace(/_/g, " ")].filter(Boolean).join(" · ");
      const options = LABEL_SIDES.map(
        (side) => `<option value="${side.value}"${side.value === city.label ? " selected" : ""}>${side.text}</option>`,
      ).join("");
      return `<li class="city" data-index="${i}">
        <input class="code" type="text" maxlength="4" value="${escapeHtml(city.code)}" aria-label="Map label for ${escapeHtml(city.name)}" />
        <div class="info">
          <span class="name">${escapeHtml(city.name)}</span>
          <span class="meta">${clockText(now, city.timeZone)} · ${escapeHtml(where)}</span>
        </div>
        <button class="pin-toggle" type="button" aria-pressed="${Boolean(city.pinned)}" aria-label="Pin ${escapeHtml(city.name)} for mini mode" title="Pin for mini mode">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${city.pinned ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.1l1.5-7L2 9.3l7-.8z"/></svg>
        </button>
        <select class="side" aria-label="Label position for ${escapeHtml(city.name)}">${options}</select>
        <button class="remove" type="button" aria-label="Remove ${escapeHtml(city.name)}" title="Remove">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <input class="note text-input" type="text" maxlength="80" placeholder="Add a note, like who you know here" value="${escapeHtml(city.note ?? "")}" aria-label="Note for ${escapeHtml(city.name)}" />
      </li>`;
    })
    .join("");
}

function cityIndex(target: EventTarget | null): number {
  const row = (target as HTMLElement | null)?.closest<HTMLElement>(".city");
  return row ? Number(row.dataset.index) : -1;
}

cityList.addEventListener("change", (event) => {
  const i = cityIndex(event.target);
  if (i < 0) return;
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  if (el.classList.contains("code")) {
    const code = el.value.trim().toUpperCase() || makeCode(settings.cities[i].name);
    el.value = code;
    update((s) => (s.cities[i].code = code));
  } else if (el.classList.contains("side")) {
    update((s) => (s.cities[i].label = el.value as LabelSide));
  } else if (el.classList.contains("note")) {
    update((s) => (s.cities[i].note = el.value.trim() || undefined));
  }
});

cityList.addEventListener("click", (event) => {
  const i = cityIndex(event.target);
  if (i < 0) return;
  const target = event.target as Element;
  if (target.closest(".remove")) {
    const key = cityKey(settings.cities[i]);
    update((s) => {
      s.cities.splice(i, 1);
      s.meetCities = s.meetCities.filter((k) => k !== key);
    }, renderCities);
  } else if (target.closest(".pin-toggle")) {
    update((s) => (s.cities[i].pinned = !s.cities[i].pinned || undefined), renderCities);
  }
});

citySort.addEventListener("change", () => update((s) => (s.citySort = citySort.value as CitySort), renderCities));

// ---- Search ----

let cityData: Promise<CityRecord[]> | undefined;
function loadCityData(): Promise<CityRecord[]> {
  // ~7,000 cities from Natural Earth via the city-timezones package; loaded only when searching.
  cityData ??= import("city-timezones/data/cityMap.json").then((m) => m.default as CityRecord[]);
  return cityData;
}

async function runSearch(): Promise<void> {
  const query = search.value.trim().toLowerCase();
  if (query.length < 2) {
    matches = [];
    results.hidden = true;
    return;
  }
  const data = await loadCityData();
  if (search.value.trim().toLowerCase() !== query) return; // a newer keystroke has taken over

  const scored = data
    .filter((c) => c.city.toLowerCase().includes(query) || c.city_ascii.toLowerCase().includes(query))
    .map((c) => ({ c, starts: c.city.toLowerCase().startsWith(query) || c.city_ascii.toLowerCase().startsWith(query) }));
  scored.sort((a, b) => Number(b.starts) - Number(a.starts) || b.c.pop - a.c.pop);
  matches = scored.slice(0, 8).map((s) => s.c);

  results.hidden = false;
  results.innerHTML = matches.length
    ? matches
        .map((c, i) => {
          const where = [c.province, c.country].filter((p) => p && p !== c.city).join(", ");
          return `<li><button type="button" class="result" data-match="${i}"><span>${escapeHtml(c.city)}</span><span class="where">${escapeHtml(where)}</span></button></li>`;
        })
        .join("")
    : `<li class="empty">No cities found.</li>`;
}

search.addEventListener("input", runSearch);

search.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && matches.length) addCity(matches[0]);
  if (event.key === "Escape") {
    search.value = "";
    runSearch();
  }
});

results.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-match]");
  if (button) addCity(matches[Number(button.dataset.match)]);
});

function addCity(record: CityRecord): void {
  const exists = settings.cities.some(
    (c) => c.name === record.city && Math.abs(c.lat - record.lat) < 0.01 && Math.abs(c.lon - record.lng) < 0.01,
  );
  if (!exists) {
    const city: City = {
      code: makeCode(record.city_ascii || record.city),
      name: record.city,
      country: record.country,
      timeZone: record.timezone,
      lat: record.lat,
      lon: record.lng,
      label: defaultLabelSide(record.lng),
    };
    update((s) => s.cities.push(city), renderCities);
  }
  search.value = "";
  runSearch();
  search.focus();
}

// ---- General ----

async function initAutostart(): Promise<void> {
  if (!inTauri) {
    autostart.disabled = true;
    return;
  }
  const { isEnabled, enable, disable } = await import("@tauri-apps/plugin-autostart");
  autostart.checked = await isEnabled();
  autostart.addEventListener("change", async () => {
    try {
      await (autostart.checked ? enable() : disable());
    } catch (error) {
      console.warn("Couldn't change start-at-sign-in", error);
      autostart.checked = await isEnabled();
    }
  });
}

// ---- Updates ----

autoUpdates.addEventListener("change", () => update((s) => (s.autoCheckUpdates = autoUpdates.checked)));

async function initUpdates(): Promise<void> {
  if (!inTauri) {
    version.textContent = "Version (preview)";
    checkNow.disabled = true;
    updateStatus.textContent = "Update checks run in the desktop app.";
    return;
  }
  const { getVersion } = await import("@tauri-apps/api/app");
  const { findUpdate, installOrOfferDownload } = await import("./updates");
  version.textContent = `Version ${await getVersion()}`;

  checkNow.addEventListener("click", async () => {
    checkNow.disabled = true;
    install.hidden = true;
    updateStatus.textContent = "Checking GitHub…";
    try {
      const { latest } = await findUpdate();
      updateStatus.textContent = latest ? `Version ${latest} is available.` : "You have the latest version.";
      install.hidden = !latest;
    } catch {
      updateStatus.textContent = "Couldn't reach GitHub. Try again later.";
    } finally {
      checkNow.disabled = false;
    }
  });

  install.addEventListener("click", async () => {
    install.disabled = true;
    checkNow.disabled = true;
    updateStatus.textContent = "Downloading the update… World Clock will restart when it's installed.";
    await installOrOfferDownload(); // only returns if the install didn't start
    updateStatus.textContent = "";
    install.disabled = false;
    checkNow.disabled = false;
  });
}

// ---- Start ----

/** Re-reads the saved settings and redraws the page; called each time Settings opens. */
export function refreshSettingsPage(): void {
  settings = loadSettings();
  autoUpdates.checked = settings.autoCheckUpdates;
  citySort.value = settings.citySort;
  miniPinned.checked = settings.miniPinnedOnly;
  renderViews();
  renderExtras();
  renderHours();
  renderWallpaper();
  renderCities();
}

initAutostart();
initUpdates();

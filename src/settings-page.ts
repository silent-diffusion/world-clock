import { cityKey, defaultLabelSide, makeCode, type City, type LabelSide } from "./cities";
import { inTauri, loadSettings, saveSettings, VIEW_INFO, type CitySort, type MapExtras, type Settings, type ViewId } from "./settings";
import { showBackgroundEditor } from "./background-editor";
import { clockText, systemTimeZone, utcOffsetMinutes } from "./time";

interface CityRecord {
  city: string;
  city_ascii: string;
  lat: number;
  lng: number;
  pop: number;
  country: string;
  iso2: string;
  province: string;
  timezone: string;
}

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
const wallpaperStatus = $<HTMLSpanElement>("wallpaper-status");
const cityList = $<HTMLUListElement>("city-list");
const search = $<HTMLInputElement>("city-search");
const results = $<HTMLUListElement>("search-results");
const autostart = $<HTMLInputElement>("autostart");
const autostartStatus = $<HTMLSpanElement>("autostart-status");
const autoUpdates = $<HTMLInputElement>("auto-updates");
const version = $<HTMLSpanElement>("version");
const updateStatus = $<HTMLSpanElement>("update-status");
const checkNow = $<HTMLButtonElement>("check-now");
const install = $<HTMLButtonElement>("install");
const citySort = $<HTMLSelectElement>("city-sort");
const cityCode = $<HTMLInputElement>("city-code");
const citySide = $<HTMLSelectElement>("city-side");
const cityPinned = $<HTMLInputElement>("city-pinned");
const cityNote = $<HTMLInputElement>("city-note");

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

/** How setting the background last went: when it last worked, why it last failed, and whether your own couldn't be saved. */
const wallpaperReport: { at?: Date; error?: string; originalLost?: boolean } = {};

/** Called by the shell after each try at setting the background, so the status line can say how it went. */
export function reportWallpaper(report: typeof wallpaperReport): void {
  Object.assign(wallpaperReport, report);
  if (inTauri) wallpaperStatus.textContent = wallpaperStatusText();
}

function wallpaperStatusText(): string {
  if (!settings.wallpaper.on) return "Your own background stays until you turn this on";
  const { at, error, originalLost } = wallpaperReport;
  const status = error ? `Couldn't set the background: ${error}` : at ? `Updated ${clockText(at, systemTimeZone)}` : "Updating every minute";
  return originalLost ? `${status} · Your previous background couldn't be saved, so it can't be put back` : status;
}

function renderWallpaper(): void {
  wallpaperOn.checked = settings.wallpaper.on;
  if (!inTauri) {
    wallpaperOn.disabled = true;
    wallpaperStatus.textContent = "Available in the desktop app";
  } else {
    wallpaperStatus.textContent = wallpaperStatusText();
  }
}

wallpaperOn.addEventListener("change", () => update((s) => (s.wallpaper.on = wallpaperOn.checked), renderWallpaper));

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
      const star = city.pinned
        ? `<svg class="pinned" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Pinned"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.1l1.5-7L2 9.3l7-.8z"/></svg>`
        : "";
      return `<li><button type="button" class="row menu-row city-row" data-index="${i}">
        <span class="code-badge">${escapeHtml(city.code)}</span>
        <span class="row-text"><span class="row-title">${escapeHtml(city.name)} ${star}</span><span class="row-sub">${clockText(now, city.timeZone)} · ${escapeHtml(where)}${city.note ? ` · ${escapeHtml(city.note)}` : ""}</span></span>
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
      </button></li>`;
    })
    .join("");
}

cityList.addEventListener("click", (event) => {
  const row = (event.target as Element).closest<HTMLElement>(".city-row");
  if (row) openCity(Number(row.dataset.index));
});

// ---- One city's page ----

let openCityIndex = -1;

function openCity(index: number): void {
  openCityIndex = index;
  const city = settings.cities[index];
  $("city-detail-name").textContent = city.name;
  $("city-detail-meta").textContent = [city.country, city.timeZone.replace(/_/g, " "), `now ${clockText(new Date(), city.timeZone)}`]
    .filter(Boolean)
    .join(" · ");
  cityCode.value = city.code;
  citySide.value = city.label;
  cityPinned.checked = Boolean(city.pinned);
  cityNote.value = city.note ?? "";
  showPanel("city", city.name);
  focusTitle();
}

function editCity(change: (city: City) => void): void {
  if (openCityIndex < 0) return;
  update((s) => change(s.cities[openCityIndex]));
}

cityCode.addEventListener("change", () => {
  const code = cityCode.value.trim().toUpperCase() || makeCode(settings.cities[openCityIndex].name);
  cityCode.value = code;
  editCity((c) => (c.code = code));
});
citySide.addEventListener("change", () => editCity((c) => (c.label = citySide.value as LabelSide)));
cityPinned.addEventListener("change", () => editCity((c) => (c.pinned = cityPinned.checked || undefined)));
cityNote.addEventListener("change", () => editCity((c) => (c.note = cityNote.value.trim() || undefined)));

$("city-remove").addEventListener("click", () => {
  if (openCityIndex < 0) return;
  const key = cityKey(settings.cities[openCityIndex]);
  update((s) => {
    s.cities.splice(openCityIndex, 1);
    s.meetCities = s.meetCities.filter((k) => k !== key);
  });
  openCityIndex = -1;
  settingsGoBack();
});

citySort.addEventListener("change", () => update((s) => (s.citySort = citySort.value as CitySort), renderCities));

// ---- Search ----

/** A city with its names already lowercased, so typing doesn't lowercase thousands of them on every key. */
interface SearchEntry {
  record: CityRecord;
  city: string;
  ascii: string;
}

let cityData: Promise<SearchEntry[]> | undefined;
function loadCityData(): Promise<SearchEntry[]> {
  // ~7,000 cities from Natural Earth via the city-timezones package; loaded only when searching.
  cityData ??= import("city-timezones/data/cityMap.json")
    .then((m) => (m.default as CityRecord[]).map((record) => ({ record, city: record.city.toLowerCase(), ascii: record.city_ascii.toLowerCase() })))
    .catch((error) => {
      cityData = undefined; // try again next time
      throw error;
    });
  return cityData;
}

async function runSearch(): Promise<void> {
  const query = search.value.trim().toLowerCase();
  if (query.length < 2) {
    matches = [];
    results.hidden = true;
    return;
  }
  let data: SearchEntry[];
  try {
    data = await loadCityData();
  } catch (error) {
    console.warn("Couldn't load the city list", error);
    matches = [];
    results.hidden = false;
    results.innerHTML = `<li class="empty">Couldn't load the city list. Type again to retry.</li>`;
    return;
  }
  if (search.value.trim().toLowerCase() !== query) return; // a newer keystroke has taken over

  const scored = data
    .filter((e) => e.city.includes(query) || e.ascii.includes(query))
    .map((e) => ({ c: e.record, starts: e.city.startsWith(query) || e.ascii.startsWith(query) }));
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
      countryCode: record.iso2,
      region: record.province,
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
    autostartStatus.hidden = true;
    try {
      await (autostart.checked ? enable() : disable());
    } catch (error) {
      console.warn("Couldn't change start-at-sign-in", error);
      autostart.checked = await isEnabled().catch(() => !autostart.checked);
      autostartStatus.textContent = `Couldn't change this: ${error instanceof Error ? error.message : String(error)}`;
      autostartStatus.hidden = false;
    }
  });
}

// ---- Quit ----

/** Quits for real: with the desktop background on, closing the window only hides it. */
function initQuit(): void {
  if (!inTauri) return;
  const quit = $<HTMLButtonElement>("quit");
  quit.hidden = false;
  quit.addEventListener("click", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("quit");
  });
}

// ---- Updates ----

/** The newer version on GitHub, once a check has found one. */
let availableVersion: string | null = null;

autoUpdates.addEventListener("change", () => update((s) => (s.autoCheckUpdates = autoUpdates.checked)));

async function initUpdates(): Promise<void> {
  if (!inTauri) {
    version.textContent = "Version (preview)";
    checkNow.disabled = true;
    updateStatus.textContent = "Update checks run in the desktop app.";
    return;
  }
  const { getVersion } = await import("@tauri-apps/api/app");
  const { findUpdate, GitHubBusyError, installOrOfferDownload, whenUpdateFound } = await import("./updates");
  version.textContent = `Version ${await getVersion()}`;

  // A newer version found by any check (including the scheduled one) is offered here and named on the main list.
  whenUpdateFound((latest) => {
    availableVersion = latest;
    updateStatus.textContent = latest ? `Version ${latest} is available.` : "You have the latest version.";
    install.hidden = !latest;
    renderSummaries();
  });

  checkNow.addEventListener("click", async () => {
    checkNow.disabled = true;
    install.hidden = true;
    updateStatus.textContent = "Checking GitHub…";
    try {
      await findUpdate(); // shown by whenUpdateFound
    } catch (error) {
      updateStatus.textContent = error instanceof GitHubBusyError ? "GitHub is busy right now — try again later." : "Couldn't reach GitHub. Try again later.";
      install.hidden = !availableVersion;
    } finally {
      checkNow.disabled = false;
    }
  });

  install.addEventListener("click", async () => {
    install.disabled = true;
    checkNow.disabled = true;
    const available = updateStatus.textContent;
    updateStatus.textContent = "Downloading the update… World Clock will restart when it's installed.";
    try {
      await installOrOfferDownload(); // only returns if the install didn't start
    } catch (error) {
      console.warn("Couldn't install the update", error);
    } finally {
      updateStatus.textContent = available;
      install.disabled = false;
      checkNow.disabled = false;
    }
  });
}

// ---- Menu ----

type PanelId = "root" | "cities" | "city" | "views" | "extras" | "hours" | "background" | "mini" | "updates";

const PANEL_TITLES: Record<Exclude<PanelId, "city">, string> = {
  root: "Settings",
  cities: "Cities",
  views: "Views",
  extras: "Map extras",
  hours: "Working hours",
  background: "Desktop background",
  mini: "Mini mode",
  updates: "Updates",
};

let currentPanel: PanelId = "root";

function parentOf(panel: PanelId): PanelId | null {
  if (panel === "root") return null;
  return panel === "city" ? "cities" : "root";
}

function showPanel(panel: PanelId, title?: string): void {
  currentPanel = panel;
  for (const el of document.querySelectorAll<HTMLElement>("#settings-view .panel")) el.hidden = el.dataset.panel !== panel;
  $("settings-title").textContent = title ?? PANEL_TITLES[panel as Exclude<PanelId, "city">];
  const parent = parentOf(panel);
  $("settings-back-label").textContent = parent ? PANEL_TITLES[parent as Exclude<PanelId, "city">] : "Back";
  document.querySelector(".settings-body")!.scrollTop = 0;
  if (panel === "root") renderSummaries();
  if (panel === "cities") renderCities();
  if (panel === "background") showBackgroundEditor(settings, (layout) => update((s) => (s.wallpaper.layout = layout)));
}

/** Goes up one level. Returns false at the top, where the caller closes Settings. */
export function settingsGoBack(): boolean {
  const parent = parentOf(currentPanel);
  if (!parent) return false;
  const from = currentPanel;
  showPanel(parent);
  // Put focus back on the row that was opened, so keyboard users keep their place.
  const opener = from === "city" ? null : document.querySelector<HTMLElement>(`[data-open="${from}"]`);
  (opener ?? $("settings-back")).focus();
  return true;
}

/** Moves focus to the page title after opening a page, since the row that opened it is now hidden. */
function focusTitle(): void {
  $("settings-title").focus();
}

document.querySelector(".settings-body")!.addEventListener("click", (event) => {
  const row = (event.target as Element).closest<HTMLElement>("[data-open]");
  if (!row) return;
  showPanel(row.dataset.open as PanelId);
  focusTitle();
});

/** The current value of each section, shown under its name on the main list. */
function renderSummaries(): void {
  const on = settings.views.filter((v) => v.on).map((v) => VIEW_INFO[v.id].name);
  const extrasOn = EXTRAS.filter((x) => settings.extras[x.id]).length;
  const pinned = settings.cities.filter((c) => c.pinned).length;
  const summaries: Record<string, string> = {
    cities: `${settings.cities.length} ${settings.cities.length === 1 ? "city" : "cities"}`,
    views: on.join(", "),
    extras: `${extrasOn} of ${EXTRAS.length} on`,
    hours: `${timeOption(settings.workStart)} – ${timeOption(settings.workEnd)}`,
    background: settings.wallpaper.on ? `On · ${settings.wallpaper.layout.map((t) => VIEW_INFO[t.view].name).join(" + ")}` : "Off",
    mini: settings.miniPinnedOnly ? `Pinned cities only (${pinned})` : "All cities",
    updates: availableVersion
      ? `Version ${availableVersion} is available`
      : `${version.textContent?.replace("…", "").trim() || "Version"}${settings.autoCheckUpdates ? " · checks automatically" : ""}`,
  };
  for (const [id, text] of Object.entries(summaries)) {
    const el = document.getElementById(`sum-${id}`);
    if (el) el.textContent = text;
  }
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
  showPanel("root");
}

initAutostart();
initUpdates();
initQuit();

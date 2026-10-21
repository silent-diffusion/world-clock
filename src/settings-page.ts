import { defaultLabelSide, makeCode, type City, type LabelSide } from "./cities";
import { inTauri, loadSettings, onSettingsChanged, saveSettings, type Settings } from "./settings";

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

const cityList = document.getElementById("city-list") as HTMLUListElement;
const search = document.getElementById("city-search") as HTMLInputElement;
const results = document.getElementById("search-results") as HTMLUListElement;
const autostart = document.getElementById("autostart") as HTMLInputElement;
const autoUpdates = document.getElementById("auto-updates") as HTMLInputElement;
const version = document.getElementById("version") as HTMLSpanElement;
const updateStatus = document.getElementById("update-status") as HTMLSpanElement;
const checkNow = document.getElementById("check-now") as HTMLButtonElement;
const download = document.getElementById("download") as HTMLButtonElement;

let settings: Settings = loadSettings();
let matches: CityRecord[] = [];

function escapeHtml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function localTime(timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date());
}

async function update(change: (s: Settings) => void, rerender = true): Promise<void> {
  change(settings);
  await saveSettings(settings);
  if (rerender) renderCities();
}

// ---- Cities ----

function renderCities(): void {
  if (settings.cities.length === 0) {
    cityList.innerHTML = `<li class="empty">No cities yet. Search below to add one.</li>`;
    return;
  }
  cityList.innerHTML = settings.cities
    .map((city, i) => {
      const where = [city.country, city.timeZone.replace(/_/g, " ")].filter(Boolean).join(" · ");
      const options = LABEL_SIDES.map(
        (side) => `<option value="${side.value}"${side.value === city.label ? " selected" : ""}>${side.text}</option>`,
      ).join("");
      return `<li class="city" data-index="${i}">
        <input class="code" type="text" maxlength="4" value="${escapeHtml(city.code)}" aria-label="Map label for ${escapeHtml(city.name)}" />
        <div class="info">
          <span class="name">${escapeHtml(city.name)}</span>
          <span class="meta"><span class="time">${localTime(city.timeZone)}</span> · ${escapeHtml(where)}</span>
        </div>
        <select class="side" aria-label="Label position for ${escapeHtml(city.name)}">${options}</select>
        <button class="remove" type="button" aria-label="Remove ${escapeHtml(city.name)}" title="Remove">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
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
    update((s) => (s.cities[i].code = code), false);
  } else if (el.classList.contains("side")) {
    update((s) => (s.cities[i].label = el.value as LabelSide), false);
  }
});

cityList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest(".remove");
  const i = cityIndex(event.target);
  if (button && i >= 0) update((s) => s.cities.splice(i, 1));
});

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
          return `<li><button type="button" data-match="${i}"><span>${escapeHtml(c.city)}</span><span class="where">${escapeHtml(where)}</span></button></li>`;
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
    update((s) => s.cities.push(city));
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

autoUpdates.addEventListener("change", () => update((s) => (s.autoCheckUpdates = autoUpdates.checked), false));

async function initUpdates(): Promise<void> {
  if (!inTauri) {
    version.textContent = "Version (preview)";
    checkNow.disabled = true;
    updateStatus.textContent = "Update checks run in the desktop app.";
    return;
  }
  const { getVersion } = await import("@tauri-apps/api/app");
  const { findUpdate, openDownload } = await import("./updates");
  version.textContent = `Version ${await getVersion()}`;

  checkNow.addEventListener("click", async () => {
    checkNow.disabled = true;
    download.hidden = true;
    updateStatus.textContent = "Checking GitHub…";
    try {
      const { latest } = await findUpdate();
      updateStatus.textContent = latest ? `Version ${latest} is available.` : "You have the latest version.";
      download.hidden = !latest;
    } catch {
      updateStatus.textContent = "Couldn't reach GitHub. Try again later.";
    } finally {
      checkNow.disabled = false;
    }
  });
  download.addEventListener("click", () => openDownload());
}

// ---- Start ----

function syncFromSettings(): void {
  settings = loadSettings();
  autoUpdates.checked = settings.autoCheckUpdates;
  renderCities();
}

syncFromSettings();
onSettingsChanged(syncFromSettings);
initAutostart();
initUpdates();

// Keep the local times in the list current.
setInterval(() => {
  cityList.querySelectorAll<HTMLElement>(".city").forEach((row) => {
    const city = settings.cities[Number(row.dataset.index)];
    const time = row.querySelector(".time");
    if (city && time) time.textContent = localTime(city.timeZone);
  });
}, 15000);

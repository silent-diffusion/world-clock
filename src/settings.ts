import { DEFAULT_CITIES, type City } from "./cities";

/** How the Settings window lists cities: as added, A–Z, or by time zone from west to east. */
export type CitySort = "added" | "name" | "timezone";

export interface Settings {
  /** Kept in the order the cities were added. */
  cities: City[];
  citySort: CitySort;
  /** Check GitHub for a newer release on launch and once a day. */
  autoCheckUpdates: boolean;
}

const STORAGE_KEY = "world-clock.settings";
const changes = new EventTarget();

export const inTauri = "__TAURI_INTERNALS__" in window;

export function loadSettings(): Settings {
  const defaults: Settings = { cities: DEFAULT_CITIES, citySort: "added", autoCheckUpdates: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    if (!saved) return defaults;
    return {
      cities: Array.isArray(saved.cities) ? saved.cities : defaults.cities,
      citySort: saved.citySort === "name" || saved.citySort === "timezone" ? saved.citySort : defaults.citySort,
      autoCheckUpdates: saved.autoCheckUpdates ?? defaults.autoCheckUpdates,
    };
  } catch {
    return defaults;
  }
}

/** Saves settings and tells the clock view to redraw. */
export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  changes.dispatchEvent(new Event("change"));
}

export function onSettingsChanged(callback: () => void): void {
  changes.addEventListener("change", callback);
}

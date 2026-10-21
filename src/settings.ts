import { DEFAULT_CITIES, type City } from "./cities";

export interface Settings {
  cities: City[];
  /** Check GitHub for a newer release on launch and once a day. */
  autoCheckUpdates: boolean;
}

const STORAGE_KEY = "world-clock.settings";
const CHANGED_EVENT = "settings-changed";

export const inTauri = "__TAURI_INTERNALS__" in window;

export function loadSettings(): Settings {
  const defaults: Settings = { cities: DEFAULT_CITIES, autoCheckUpdates: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    if (!saved) return defaults;
    return {
      cities: Array.isArray(saved.cities) ? saved.cities : defaults.cities,
      autoCheckUpdates: saved.autoCheckUpdates ?? defaults.autoCheckUpdates,
    };
  } catch {
    return defaults;
  }
}

/** Saves settings and tells the other window (widget or settings) to reload them. */
export async function saveSettings(settings: Settings): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  if (inTauri) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(CHANGED_EVENT);
  }
}

export function onSettingsChanged(callback: () => void): void {
  if (inTauri) {
    import("@tauri-apps/api/event").then(({ listen }) => listen(CHANGED_EVENT, callback));
  } else {
    // Browser preview: the settings page in another tab writes to the same localStorage.
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) callback();
    });
  }
}

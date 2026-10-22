import { cityKey, DEFAULT_CITIES, type City } from "./cities";

/** How the Settings city list is ordered: as added, A–Z, or by time zone from west to east. */
export type CitySort = "added" | "name" | "timezone";

export type ViewId = "map" | "day" | "sky" | "dial" | "meet";

export const VIEW_INFO: Record<ViewId, { name: string; description: string }> = {
  map: { name: "Map", description: "Every city on a live day-and-night map, with its time beside it" },
  day: { name: "Day", description: "A 24-hour day and night bar per city, with working hours" },
  sky: { name: "Sky", description: "A card per city, coloured by its sky right now" },
  dial: { name: "Dial", description: "All cities around one 24-hour clock face" },
  meet: { name: "Meet", description: "Find the hours when everyone is at work" },
};

export interface MapExtras {
  /** Shade the part of the world where it's already the next day. */
  dateBoundary: boolean;
  /** Fade cities where it's between 11 PM and 7 AM. */
  dimAsleep: boolean;
  /** Label cities with their gap from the selected city (or from you) instead of the clock time. */
  relative: boolean;
  /** Clicking a city opens sunrise, sunset, golden hour, clock changes and its note. */
  details: boolean;
  /** Warn a week before a city's clocks change. */
  clockAlerts: boolean;
}

/** One view placed on the desktop background, as fractions of the screen (0 to 1). */
export interface BackgroundTile {
  view: ViewId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The default background: the map filling the screen above the taskbar. */
export const FULL_SCREEN_MAP: BackgroundTile = { view: "map", x: 0, y: 0, w: 1, h: 0.95 };

export interface Settings {
  /** Kept in the order the cities were added. */
  cities: City[];
  citySort: CitySort;
  /** Check GitHub for a newer release on launch and once a day. */
  autoCheckUpdates: boolean;
  /** Swipe order of the views and whether each is shown. The map is always shown. */
  views: { id: ViewId; on: boolean }[];
  extras: MapExtras;
  /** Working hours in local minutes after midnight, used by the Day and Meet views. */
  workStart: number;
  workEnd: number;
  /** Keys of the cities in the meeting finder. */
  meetCities: string[];
  /** Meet view row order: earliest local time first, A–Z, or the order the user dragged them into. */
  meetSort: "time" | "name" | "custom";
  /** Mini mode shows only pinned cities. */
  miniPinnedOnly: boolean;
  /** Use a view as the desktop background, redrawn every minute. */
  wallpaper: { on: boolean; layout: BackgroundTile[] };
}

const STORAGE_KEY = "world-clock.settings";
const changes = new EventTarget();

export const inTauri = "__TAURI_INTERNALS__" in window;

export function defaultSettings(): Settings {
  return {
    cities: DEFAULT_CITIES.map((c) => ({ ...c })),
    citySort: "added",
    autoCheckUpdates: true,
    views: [
      { id: "map", on: true },
      { id: "day", on: true },
      { id: "sky", on: true },
      { id: "dial", on: false },
      { id: "meet", on: true },
    ],
    extras: { dateBoundary: false, dimAsleep: true, relative: false, details: true, clockAlerts: true },
    workStart: 9 * 60,
    workEnd: 17 * 60,
    meetCities: DEFAULT_CITIES.slice(3, 6).map(cityKey),
    meetSort: "time",
    miniPinnedOnly: false,
    wallpaper: { on: false, layout: [{ ...FULL_SCREEN_MAP }] },
  };
}

/** Keeps every known view exactly once, in the saved order, with the map always on. */
function normalizeViews(saved: unknown, fallback: Settings["views"]): Settings["views"] {
  const known = Object.keys(VIEW_INFO) as ViewId[];
  const list = Array.isArray(saved)
    ? (saved as { id: ViewId; on: boolean }[]).filter((v, i, all) => known.includes(v?.id) && all.findIndex((w) => w.id === v.id) === i)
    : [];
  for (const v of fallback) if (!list.some((w) => w.id === v.id)) list.push({ ...v });
  return list.map((v) => ({ id: v.id, on: v.id === "map" ? true : Boolean(v.on) }));
}

const clamp = (n: unknown, min: number, max: number, fallback: number): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;

/** Valid tiles only; 1.1.x saved a single view, which becomes one full-screen tile. */
function normalizeLayout(saved: unknown): BackgroundTile[] {
  const s = saved as { layout?: unknown; view?: unknown } | undefined;
  if (Array.isArray(s?.layout)) {
    const tiles = (s!.layout as Partial<BackgroundTile>[])
      .filter((tile) => tile && typeof tile.view === "string" && tile.view in VIEW_INFO)
      .map((tile) => {
        const w = clamp(tile.w, 0.05, 1, 1);
        const h = clamp(tile.h, 0.05, 1, 1);
        return { view: tile.view as ViewId, w, h, x: clamp(tile.x, 0, 1 - w, 0), y: clamp(tile.y, 0, 1 - h, 0) };
      });
    if (tiles.length) return tiles;
  }
  const view = typeof s?.view === "string" && s.view in VIEW_INFO ? (s.view as ViewId) : "map";
  return [{ ...FULL_SCREEN_MAP, view }];
}

export function loadSettings(): Settings {
  const defaults = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    if (!saved) return defaults;
    const cities = Array.isArray(saved.cities) ? saved.cities : defaults.cities;
    const keys = cities.map(cityKey);
    return {
      cities,
      citySort: saved.citySort === "name" || saved.citySort === "timezone" ? saved.citySort : defaults.citySort,
      autoCheckUpdates: saved.autoCheckUpdates ?? defaults.autoCheckUpdates,
      views: normalizeViews(saved.views, defaults.views),
      extras: { ...defaults.extras, ...(saved.extras ?? {}) },
      workStart: typeof saved.workStart === "number" ? saved.workStart : defaults.workStart,
      workEnd: typeof saved.workEnd === "number" ? saved.workEnd : defaults.workEnd,
      // Existing users get the meeting finder pre-filled with three of their own cities.
      meetCities: Array.isArray(saved.meetCities) ? saved.meetCities.filter((k) => keys.includes(k)) : keys.slice(0, 3),
      meetSort: saved.meetSort === "name" || saved.meetSort === "custom" ? saved.meetSort : defaults.meetSort,
      miniPinnedOnly: saved.miniPinnedOnly ?? defaults.miniPinnedOnly,
      wallpaper: { on: Boolean(saved.wallpaper?.on), layout: normalizeLayout(saved.wallpaper) },
    };
  } catch {
    return defaults;
  }
}

/** Saves settings and tells every view to redraw. */
export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  changes.dispatchEvent(new Event("change"));
}

export function onSettingsChanged(callback: () => void): void {
  changes.addEventListener("change", callback);
}

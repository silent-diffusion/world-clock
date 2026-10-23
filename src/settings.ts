import { cityKey, DEFAULT_CITIES, defaultLabelSide, type City, type LabelSide } from "./cities";

/** How the Settings city list is ordered: as added, A–Z, or by time zone from west to east. */
export type CitySort = "added" | "name" | "timezone";

export type ViewId = "map" | "day" | "sky" | "dial" | "meet" | "year" | "clock";

export const VIEW_INFO: Record<ViewId, { name: string; description: string }> = {
  map: { name: "Map", description: "Every city on a live day-and-night map, with its time beside it" },
  day: { name: "Day", description: "A 24-hour day and night bar per city, with working hours" },
  sky: { name: "Sky", description: "A card per city, coloured by its sky right now" },
  dial: { name: "Dial", description: "All cities around one 24-hour clock face" },
  meet: { name: "Meet", description: "Find the hours when everyone is at work" },
  year: { name: "Year", description: "The year at a glance: clock changes, holidays and unusual gaps in your cities" },
  clock: { name: "Clock", description: "Your own time and date, large, for the desktop background" },
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
  /** What the Year view marks. */
  yearMarks: { changes: boolean; holidays: boolean; gaps: boolean };
  /** Mini mode shows only pinned cities. */
  miniPinnedOnly: boolean;
  /** Use a view as the desktop background, redrawn every minute. */
  wallpaper: { on: boolean; layout: BackgroundTile[] };
}

const STORAGE_KEY = "world-clock.settings";
const changes = new EventTarget();

export const inTauri = "__TAURI_INTERNALS__" in window;

/** Set when loading found nothing saved: the app's first run (and later ones until a setting is changed). */
export let firstRun = false;

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
      { id: "year", on: true },
      { id: "clock", on: false },
    ],
    extras: { dateBoundary: false, dimAsleep: true, relative: false, details: true, clockAlerts: true },
    workStart: 9 * 60,
    workEnd: 17 * 60,
    meetCities: DEFAULT_CITIES.slice(3, 6).map(cityKey),
    meetSort: "time",
    yearMarks: { changes: true, holidays: true, gaps: true },
    miniPinnedOnly: false,
    wallpaper: { on: false, layout: [{ ...FULL_SCREEN_MAP }] },
  };
}

/** Keeps every known view exactly once, in the saved order, with the map always on. */
function normalizeViews(saved: unknown, fallback: Settings["views"]): Settings["views"] {
  const valid: { id: ViewId; on: boolean }[] = Array.isArray(saved) ? saved.filter((v) => typeof v?.id === "string" && Object.hasOwn(VIEW_INFO, v.id)) : [];
  const list = valid.filter((v, i) => valid.findIndex((w) => w.id === v.id) === i);
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
      .filter((tile) => tile && typeof tile.view === "string" && Object.hasOwn(VIEW_INFO, tile.view))
      .map((tile) => {
        const w = clamp(tile.w, 0.05, 1, 1);
        const h = clamp(tile.h, 0.05, 1, 1);
        return { view: tile.view as ViewId, w, h, x: clamp(tile.x, 0, 1 - w, 0), y: clamp(tile.y, 0, 1 - h, 0) };
      });
    if (tiles.length) return tiles;
  }
  const view = typeof s?.view === "string" && Object.hasOwn(VIEW_INFO, s.view) ? (s.view as ViewId) : "map";
  return [{ ...FULL_SCREEN_MAP, view }];
}

const LABEL_SIDES: LabelSide[] = ["left", "right", "above", "below"];

/** A saved city, cleaned up; null when it's too damaged to use, so it's skipped instead of losing every city. */
function normalizeCity(saved: unknown): City | null {
  const c = saved as Record<string, unknown> | null;
  if (!c || typeof c.name !== "string" || typeof c.code !== "string" || typeof c.timeZone !== "string") return null;
  if (typeof c.lat !== "number" || typeof c.lon !== "number" || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  return {
    code: c.code,
    name: c.name,
    country: text(c.country),
    countryCode: text(c.countryCode),
    region: text(c.region),
    timeZone: c.timeZone,
    lat: c.lat,
    lon: c.lon,
    label: LABEL_SIDES.includes(c.label as LabelSide) ? (c.label as LabelSide) : defaultLabelSide(c.lon),
    pinned: c.pinned === true || undefined,
    note: text(c.note)?.slice(0, 200),
  };
}

export function loadSettings(): Settings {
  const defaults = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    if (!saved) {
      firstRun = true;
      return defaults;
    }
    const cities = Array.isArray(saved.cities) ? saved.cities.map(normalizeCity).filter((c) => c !== null) : defaults.cities;
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
      yearMarks: { ...defaults.yearMarks, ...(saved.yearMarks ?? {}) },
      miniPinnedOnly: saved.miniPinnedOnly ?? defaults.miniPinnedOnly,
      wallpaper: { on: Boolean(saved.wallpaper?.on), layout: normalizeLayout(saved.wallpaper) },
    };
  } catch {
    return defaults;
  }
}

/** Saves settings and tells every view to redraw. */
export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    // Storage full or blocked: everything still redraws, from the settings that were saved before.
    console.warn("Couldn't save settings", error);
  }
  changes.dispatchEvent(new Event("change"));
}

export function onSettingsChanged(callback: () => void): void {
  changes.addEventListener("change", callback);
}

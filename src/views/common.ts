import { cityKey, type City } from "../cities";
import type { Settings } from "../settings";
import { shownTime, state } from "../state";
import { solarElevation, sunPosition, type SunPosition } from "../sun";
import { clockText, localDay, localMinutes, systemTimeZone, timeParts, utcOffsetMinutes, weekday } from "../time";

/** Everything the views need to know about one city at the moment being shown. */
export interface CityInfo {
  city: City;
  key: string;
  /** "11:24" and "A"/"P" at the shown time. */
  time: string;
  period: string;
  /** "11:24 AM" */
  clock: string;
  /** Minutes since local midnight at the shown time. */
  minutes: number;
  /** Shown local date minus today's local date (non-zero only while scrubbing across midnight). */
  dayShift: number;
  /** The city's date compared with yours at the shown time: -1, 0 or 1 (rarely ±2). */
  dayFromYou: number;
  weekday: string;
  /** UTC offset in minutes at the shown time. */
  offset: number;
  elevation: number;
  isDay: boolean;
  /** Between 11 PM and 7 AM local time. */
  asleep: boolean;
  selected: boolean;
}

export interface Snapshot {
  now: Date;
  shown: Date;
  sun: SunPosition;
  shifted: boolean;
  cities: CityInfo[];
  /** Cities ordered west to east by their current UTC offset (ties by longitude). */
  byZone: CityInfo[];
  /** Your own UTC offset at the shown time. */
  yourOffset: number;
}

export function snapshot(settings: Settings): Snapshot {
  const now = new Date();
  const shown = shownTime();
  const sun = sunPosition(shown);
  const yourDay = localDay(shown, systemTimeZone);
  const cities = settings.cities.map((city) => {
    const { time, period } = timeParts(shown, city.timeZone);
    const minutes = localMinutes(shown, city.timeZone);
    const day = localDay(shown, city.timeZone);
    const elevation = solarElevation(city.lat, city.lon, sun);
    const key = cityKey(city);
    return {
      city,
      key,
      time,
      period,
      clock: clockText(shown, city.timeZone),
      minutes,
      dayShift: state.offsetMinutes ? day - localDay(now, city.timeZone) : 0,
      dayFromYou: day - yourDay,
      weekday: weekday(shown, city.timeZone),
      offset: utcOffsetMinutes(city.timeZone, shown),
      elevation,
      isDay: elevation > 0,
      asleep: minutes < 7 * 60 || minutes >= 23 * 60,
      selected: key === state.selectedKey,
    };
  });
  const byZone = [...cities].sort((a, b) => a.offset - b.offset || a.city.lon - b.city.lon);
  return { now, shown, sun, shifted: state.offsetMinutes !== 0, cities, byZone, yourOffset: utcOffsetMinutes(systemTimeZone, shown) };
}

export function escapeHtml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * Replaces a view's markup and puts keyboard focus back on the same control: the one with the same id, or with
 * the same data attributes (a city's data-key, a Year day's data-year and data-day). Views redraw every minute
 * and on every scrub step, which would otherwise drop focus back to the page.
 */
export function replaceKeepingFocus(root: Element, html: string): void {
  const focused = document.activeElement;
  let selector = "";
  if (focused && focused !== root && root.contains(focused)) {
    selector = focused.id
      ? `#${CSS.escape(focused.id)}`
      : [...focused.attributes]
          .filter((a) => a.name.startsWith("data-"))
          .map((a) => `[${a.name}="${CSS.escape(a.value)}"]`)
          .join("");
  }
  root.innerHTML = html;
  if (selector) root.querySelector<HTMLElement | SVGElement>(selector)?.focus({ preventScroll: true });
}

/** "Thu" when a city's date differs from yours, "+1d" when scrubbing moved it to another day, else "". */
export function dayMark(info: CityInfo, shifted: boolean): string {
  if (shifted && info.dayShift) return `${info.dayShift > 0 ? "+" : "−"}${Math.abs(info.dayShift)}d`;
  if (!shifted && info.dayFromYou) return info.weekday;
  return "";
}

/** Map coordinates: x and y as percentages of the 1000×405 map (latitudes 84°N to 62°S). */
export const LAT_TOP = 84;
export const LAT_SPAN = 146;
export const mapX = (lon: number): number => ((lon + 180) / 360) * 100;
export const mapY = (lat: number): number => ((LAT_TOP - lat) / LAT_SPAN) * 100;

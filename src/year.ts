import { cityKey, type City } from "./cities";
import { utcOffsetMinutes } from "./time";

// What the Year view knows about a calendar year: when each city's clocks change, the weeks when the gap
// between two cities isn't its usual one (because they change clocks on different dates), and public holidays.
// Days are counted from 1 January (day 0) of the year.

const DAY = 86_400_000;
/** Days looked at before and after the year, so gaps that start in December or end in January are judged right. */
const PAD = 60;
/** A gap that lasts less than this many days is a short-lived one, not a season. */
const SHORT_GAP_DAYS = 42;

export const daysInYear = (year: number): number => (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY;

/** The calendar date of a day in the year, as a UTC-noon Date (for formatting with timeZone "UTC"). */
export const dateOfDay = (year: number, day: number): Date => new Date(Date.UTC(year, 0, 1 + day, 12));

const offsetCache = new Map<string, number[]>();

/** UTC offset at local noon on every day of the year, with PAD days either side (index 0 is day −PAD). */
function noonOffsets(timeZone: string, year: number): number[] {
  const cacheKey = `${timeZone}|${year}`;
  const cached = offsetCache.get(cacheKey);
  if (cached) return cached;
  const offsets: number[] = [];
  let offset = utcOffsetMinutes(timeZone, new Date(Date.UTC(year, 0, 1 - PAD, 12)));
  for (let i = 0; i < daysInYear(year) + 2 * PAD; i++) {
    offset = utcOffsetMinutes(timeZone, new Date(Date.UTC(year, 0, 1 - PAD + i, 12) - offset * 60_000));
    offsets.push(offset);
  }
  offsetCache.set(cacheKey, offsets);
  return offsets;
}

/** Days of the year on which a time zone's clocks change. */
export function clockChangeDays(timeZone: string, year: number): number[] {
  const offsets = noonOffsets(timeZone, year);
  const days: number[] = [];
  for (let day = 0; day < daysInYear(year); day++) if (offsets[day + PAD] !== offsets[day + PAD - 1]) days.push(day);
  return days;
}

export interface GapRun {
  /** First day and the day after the last, counted from 1 January (may reach outside the year). */
  from: number;
  to: number;
  /** Minutes the city is ahead of the reference. */
  gap: number;
  /** A short stretch between the two places' clock changes, when the gap isn't the usual one. */
  unusual: boolean;
  /** The gap before or after this stretch (the longer of the two). */
  usual: number;
}

/** How far ahead of `reference` a time zone is through the year, as stretches of equal gap. */
export function gapRuns(timeZone: string, reference: string, year: number): GapRun[] {
  const mine = noonOffsets(timeZone, year);
  const theirs = noonOffsets(reference, year);
  const runs: GapRun[] = [];
  mine.forEach((offset, i) => {
    const gap = offset - theirs[i];
    const last = runs.at(-1);
    if (last && last.gap === gap) last.to = i - PAD + 1;
    else runs.push({ from: i - PAD, to: i - PAD + 1, gap, unusual: false, usual: gap });
  });
  runs.forEach((run, i) => {
    // Runs cut off at either end of the padded range might be long; only judge the ones fully inside.
    if (i === 0 || i === runs.length - 1 || run.to - run.from >= SHORT_GAP_DAYS) return;
    const before = runs[i - 1];
    const after = runs[i + 1];
    run.unusual = true;
    run.usual = before.to - before.from >= after.to - after.from ? before.gap : after.gap;
  });
  return runs.filter((run) => run.to > 0 && run.from < daysInYear(year));
}

export interface Holiday {
  name: string;
  /** Names of the cities where it's a public holiday. */
  cities: string[];
}

type HolidayLib = typeof import("date-holidays").default;
let holidayLib: Promise<HolidayLib> | null = null;
let cityData: Promise<{ city: string; lat: number; lng: number; country: string; iso2: string; province: string }[]> | null = null;
const holidayCache = new Map<string, Map<number, Holiday[]>>();

/** A saved city's country code and region; cities saved before 1.3 are looked up by name and position. */
async function placeOf(city: City): Promise<{ country: string; region?: string } | null> {
  if (city.countryCode) return { country: city.countryCode, region: city.region };
  cityData ??= import("city-timezones/data/cityMap.json").then((m) => m.default as never);
  const data = await cityData;
  const record =
    data.find((r) => r.city === city.name && Math.abs(r.lat - city.lat) < 0.05 && Math.abs(r.lng - city.lon) < 0.05) ??
    data.find((r) => r.country === city.country);
  return record ? { country: record.iso2, region: record.province } : null;
}

/** Public holidays in the given cities, by day of the year. Loads the holiday data the first time. */
export async function holidaysIn(cities: City[], year: number): Promise<Map<number, Holiday[]>> {
  const cacheKey = `${year}|${cities.map(cityKey).join(";")}`;
  const cached = holidayCache.get(cacheKey);
  if (cached) return cached;
  holidayLib ??= import("date-holidays").then((m) => m.default);
  const Holidays = await holidayLib;

  const byDay = new Map<number, Holiday[]>();
  for (const city of cities) {
    const place = await placeOf(city);
    if (!place) continue;
    // The region is a name ("Bern"); the holiday data wants its code ("BE").
    const states = (new Holidays().getStates(place.country) ?? {}) as Record<string, string>;
    const region = place.region?.toLowerCase();
    const state = region ? Object.keys(states).find((code) => states[code].toLowerCase().replace(/^(kanton|canton|state of) /, "") === region) : undefined;
    const options = { languages: ["en"] };
    const lookup = state ? new Holidays(place.country, state, options) : new Holidays(place.country, options);
    for (const holiday of lookup.getHolidays(year)) {
      if (holiday.type !== "public") continue;
      const [y, m, d] = holiday.date.slice(0, 10).split("-").map(Number);
      const day = (Date.UTC(y, m - 1, d) - Date.UTC(year, 0, 1)) / DAY;
      const list = byDay.get(day) ?? [];
      const same = list.find((h) => h.name === holiday.name);
      if (same) {
        if (!same.cities.includes(city.name)) same.cities.push(city.name);
      } else list.push({ name: holiday.name, cities: [city.name] });
      byDay.set(day, list);
    }
  }
  holidayCache.set(cacheKey, byDay);
  return byDay;
}

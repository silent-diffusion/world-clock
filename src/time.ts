// Time-zone helpers built on the browser's IANA time zone data (Intl), so daylight saving is always right.

const MINUTE = 60_000;

export const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A formatter made once and reused: making one takes far longer than formatting with it. */
export function dateFormat(timeZone: string, options: Intl.DateTimeFormatOptions, locale = "en-US"): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    formatters.set(key, format);
  }
  return format;
}

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return dateFormat(timeZone, options).formatToParts(date);
}

function part(list: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return list.find((p) => p.type === type)?.value ?? "";
}

/** "11:24" and "A"/"P" (or "" in 24-hour mode) for a moment in a time zone. */
export function timeParts(date: Date, timeZone: string, hour24 = false): { time: string; period: string } {
  const p = parts(date, timeZone, { hour: "numeric", minute: "2-digit", hourCycle: hour24 ? "h23" : "h12" });
  return { time: `${part(p, "hour")}:${part(p, "minute")}`, period: hour24 ? "" : part(p, "dayPeriod").charAt(0) };
}

/** "5:24 PM" */
export function clockText(date: Date, timeZone: string): string {
  return dateFormat(timeZone, { hour: "numeric", minute: "2-digit" }).format(date);
}

/** "Thu" */
export function weekday(date: Date, timeZone: string): string {
  return dateFormat(timeZone, { weekday: "short" }).format(date);
}

/** "Wednesday 21 October" */
export function longDate(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { weekday: "long", day: "numeric", month: "long" });
  return `${part(p, "weekday")} ${part(p, "day")} ${part(p, "month")}`;
}

/** Minutes since local midnight. */
export function localMinutes(date: Date, timeZone: string): number {
  const p = parts(date, timeZone, { hour: "numeric", minute: "numeric", hourCycle: "h23" });
  return Number(part(p, "hour")) * 60 + Number(part(p, "minute"));
}

/** The calendar day (days since 1970) it is in a time zone at a given moment. */
export function localDay(date: Date, timeZone: string): number {
  const p = parts(date, timeZone, { year: "numeric", month: "numeric", day: "numeric" });
  return Date.UTC(Number(part(p, "year")), Number(part(p, "month")) - 1, Number(part(p, "day"))) / 86_400_000;
}

/** Offset from UTC in minutes at a moment, e.g. -240 for New York in summer. */
export function utcOffsetMinutes(timeZone: string, date = new Date()): number {
  const name = part(parts(date, timeZone, { timeZoneName: "longOffset" }), "timeZoneName");
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0; // "GMT" alone means UTC+0
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/** The moment a local date and time (days since 1970, minutes after midnight) happens in a time zone. */
export function fromLocalTime(day: number, minutes: number, timeZone: string): Date {
  const wall = day * 86_400_000 + minutes * MINUTE; // as if the zone were UTC
  const offsetAt = (t: number) => utcOffsetMinutes(timeZone, new Date(t)) * MINUTE;
  // Guess the offset, then take it again at the guess: right even when the clocks change that day.
  const guess = wall - offsetAt(wall);
  const at = wall - offsetAt(guess);
  // A time skipped when the clocks went forward is taken as the moment they did.
  return new Date(at === wall - offsetAt(at) ? at : Math.max(guess, at));
}

/** The moment local midnight began for the local day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  return fromLocalTime(localDay(date, timeZone), 0, timeZone);
}

export interface ClockChange {
  at: Date;
  /** Offset change in minutes: -60 when clocks go back an hour. */
  delta: number;
  /** Local wall-clock time just before the change, e.g. "3:00 AM". */
  fromText: string;
  /** Local wall-clock time just after it, e.g. "2:00 AM". */
  toText: string;
}

/** How far apart nextClockChange looks. No zone changes its clocks and back again within this long. */
const CHANGE_STEP = 12 * 60 * MINUTE;

/** The next daylight-saving change in a time zone within `days`, found twelve hours at a time, then to the minute. */
export function nextClockChange(timeZone: string, from: Date, days: number): ClockChange | null {
  const fromMinute = Math.floor(from.getTime() / MINUTE) * MINUTE; // so the same change is always found at the same moment
  const start = utcOffsetMinutes(timeZone, new Date(fromMinute));
  const end = fromMinute + days * 24 * 60 * MINUTE;
  for (let step = fromMinute; step < end; step += CHANGE_STEP) {
    let lo = step;
    let hi = Math.min(step + CHANGE_STEP, end);
    if (utcOffsetMinutes(timeZone, new Date(hi)) === start) continue;
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
      if (utcOffsetMinutes(timeZone, new Date(mid)) === start) lo = mid;
      else hi = mid;
    }
    const at = new Date(hi);
    const after = utcOffsetMinutes(timeZone, at);
    const delta = after - start;
    const toText = clockText(at, timeZone);
    const fromText = clockText(new Date(at.getTime() + start * MINUTE), "UTC"); // the moment of the change on the old clock
    return { at, delta, fromText, toText };
  }
  return null;
}

/** "Sun 25 Oct" */
export function shortDate(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { weekday: "short", day: "numeric", month: "short" });
  return `${part(p, "weekday")} ${part(p, "day")} ${part(p, "month")}`;
}

/** "1 hr 5 min", "45 min" */
export function duration(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** "+4 hr", "−2 hr 30 min", "+45 min"; two days or more: "+11d", "+10d 5 hr" */
export function formatShift(minutes: number, now = new Date()): string {
  const sign = minutes < 0 ? "−" : "+";
  if (Math.abs(minutes) < 2 * 1440) return sign + duration(minutes);
  // Days picked in the Year view are counted on your own clock, so a clock change in between doesn't turn "+3d" into "+2d 23 hr".
  const shown = new Date(now.getTime() + minutes * MINUTE);
  const wall = (localDay(shown, systemTimeZone) - localDay(now, systemTimeZone)) * 1440 + localMinutes(shown, systemTimeZone) - localMinutes(now, systemTimeZone);
  const days = Math.floor(Math.abs(wall) / 1440);
  const rest = Math.abs(wall) % 1440;
  return `${sign}${days}d${rest ? ` ${duration(rest)}` : ""}`;
}

/** "+6h", "−3h", "+5h 30m", "Same time" */
export function formatGap(minutes: number): string {
  if (minutes === 0) return "Same time";
  const sign = minutes < 0 ? "−" : "+";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `${sign}${h ? `${h}h` : ""}${m ? `${h ? " " : ""}${m}m` : ""}`;
}

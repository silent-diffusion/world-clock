// Time-zone helpers built on the browser's IANA time zone data (Intl), so daylight saving is always right.

const MINUTE = 60_000;

export const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(date);
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
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

/** "Thu" */
export function weekday(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
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

/** The moment local midnight began for the local day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const approx = new Date(date.getTime() - localMinutes(date, timeZone) * MINUTE);
  return new Date(Math.floor(approx.getTime() / MINUTE) * MINUTE);
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

/** The next daylight-saving change in a time zone within `days`, found hour by hour, then to the minute. */
export function nextClockChange(timeZone: string, from: Date, days: number): ClockChange | null {
  const start = utcOffsetMinutes(timeZone, from);
  for (let h = 1; h <= days * 24; h++) {
    const probe = new Date(from.getTime() + h * 60 * MINUTE);
    if (utcOffsetMinutes(timeZone, probe) === start) continue;
    let lo = probe.getTime() - 60 * MINUTE;
    let hi = probe.getTime();
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
      if (utcOffsetMinutes(timeZone, new Date(mid)) === start) lo = mid;
      else hi = mid;
    }
    const at = new Date(hi);
    const after = utcOffsetMinutes(timeZone, at);
    const delta = after - start;
    const toText = clockText(at, timeZone);
    const fromText = clockText(new Date(at.getTime() - delta * MINUTE), timeZone);
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

/** "+4 hr", "−2 hr 30 min", "+45 min" */
export function formatShift(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  // Days picked in the Year view: "+3 days" rather than "+72 hr" (a clock change can make it 71 or 73).
  const days = Math.abs(minutes) / 1440;
  if (days >= 2 && Math.abs(days - Math.round(days)) <= 1 / 24) return `${sign}${Math.round(days)} days`;
  return sign + duration(minutes);
}

/** "+6h", "−3h", "+5h 30m", "Same time" */
export function formatGap(minutes: number): string {
  if (minutes === 0) return "Same time";
  const sign = minutes < 0 ? "−" : "+";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `${sign}${h ? `${h}h` : ""}${m ? `${h ? " " : ""}${m}m` : ""}`;
}

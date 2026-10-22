import { longDate, systemTimeZone, timeParts } from "../time";
import type { Snapshot } from "./common";

// The Clock view: your own local time and date, large, sized to whatever space it has. Made for the
// desktop background, where it's redrawn on every minute.

const root = document.getElementById("clock-view")!;

/** "Mountain Daylight Time", or the IANA name if the browser has no long name for the zone. */
function zoneName(moment: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: systemTimeZone, timeZoneName: "long" })
    .formatToParts(moment)
    .find((p) => p.type === "timeZoneName")?.value;
  return name ?? systemTimeZone.replace(/_/g, " ");
}

export function renderClock(snap: Snapshot): void {
  const { time, period } = timeParts(snap.shown, systemTimeZone);
  const year = snap.shown.toLocaleDateString("en-US", { timeZone: systemTimeZone, year: "numeric" });
  root.innerHTML = `
    <div class="clock-face" role="timer" aria-label="Your time: ${time} ${period}M, ${longDate(snap.shown, systemTimeZone)}">
      <div class="clock-time">${time}<span class="clock-ap">${period}M</span></div>
      <div class="clock-date">${longDate(snap.shown, systemTimeZone)} ${year}</div>
      <div class="clock-zone">${zoneName(snap.shown)}</div>
    </div>`;
}

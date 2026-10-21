import { formatGap } from "../time";
import { dayMark, escapeHtml, type CityInfo, type Snapshot } from "./common";

const root = document.getElementById("sky-view")!;

/** The real sky: night below the horizon, twilight just around it, then morning, afternoon, or evening once the sun is low after noon. */
function sky(info: CityInfo): { id: string; label: string } {
  if (info.elevation < -6) return { id: "night", label: "Night" };
  if (info.elevation < 0) return { id: "twilight", label: "Twilight" };
  if (info.minutes < 12 * 60) return { id: "morning", label: "Morning" };
  if (info.elevation >= 15) return { id: "afternoon", label: "Afternoon" };
  return { id: "evening", label: "Evening" };
}

export function renderSky(snap: Snapshot): void {
  root.innerHTML = snap.byZone
    .map((info) => {
      const { city } = info;
      const s = sky(info);
      const mark = dayMark(info, snap.shifted);
      const gap = info.offset === snap.yourOffset ? "Your time" : formatGap(info.offset - snap.yourOffset);
      return `<button type="button" class="sky-card sky-${s.id}${info.selected ? " selected" : ""}" data-key="${escapeHtml(info.key)}" aria-pressed="${info.selected}" aria-label="${escapeHtml(`${city.name}, ${info.clock}, ${s.label}`)}">
        <span class="top"><span class="code">${escapeHtml(city.code)}</span><span class="sub">${s.label}${mark ? ` · ${mark}` : ""}</span></span>
        <span class="big">${info.time}<span class="ap">${info.period}M</span></span>
        <span class="bottom"><span class="sub">${escapeHtml(city.name)}</span><span class="sub">${gap}</span></span>
      </button>`;
    })
    .join("");
}

import { clockText, longDate, systemTimeZone } from "../time";
import { escapeHtml, type Snapshot } from "./common";

const svg = document.getElementById("dial") as unknown as SVGSVGElement;

// A 24-hour face: noon at the top, midnight at the bottom, morning on the left and evening on the right.
const CX = 500;
const CY = 280;
const R = 190;

function point(minutes: number, radius: number): { x: number; y: number } {
  const a = ((minutes / 1440) * 360 + 180) * (Math.PI / 180);
  return { x: CX + radius * Math.sin(a), y: CY - radius * Math.cos(a) };
}

const f = (n: number) => n.toFixed(1);

export function renderDial(snap: Snapshot): void {
  const ticks: string[] = [];
  for (let h = 0; h < 24; h++) {
    const a = point(h * 60, R - 21);
    const b = point(h * 60, R - (h % 6 === 0 ? 33 : 27));
    ticks.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="rgba(244,247,255,0.35)" stroke-width="${h % 6 === 0 ? 2 : 1}"/>`);
  }
  const labels = (
    [
      [0, "MIDNIGHT"],
      [360, "6 AM"],
      [720, "NOON"],
      [1080, "6 PM"],
    ] as const
  ).map(([m, text]) => {
    const p = point(m, R - 54);
    return `<text class="hour-label" x="${f(p.x)}" y="${f(p.y)}" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
  });

  // Cities close together on the face alternate between an inner and an outer label ring.
  const sorted = [...snap.cities].sort((a, b) => a.minutes - b.minutes);
  let lastAngle = -999;
  let lastBumped = false;
  const cities = sorted.map((info) => {
    const angle = (info.minutes / 1440) * 360;
    const bump = angle - lastAngle < 20 && !lastBumped;
    lastAngle = angle;
    lastBumped = bump;
    const dot = point(info.minutes, R);
    const labelRadius = R + (bump ? 76 : 38);
    const label = point(info.minutes, labelRadius);
    const lineEnd = point(info.minutes, labelRadius - 12);
    const anchor = Math.abs(label.x - CX) < 30 ? "middle" : label.x > CX ? "start" : "end";
    const pin = info.selected ? "var(--amber)" : "var(--pin)";
    return `<g class="dial-city" data-key="${escapeHtml(info.key)}" role="button" tabindex="0" aria-pressed="${info.selected}" aria-label="${escapeHtml(`${info.city.name}, ${info.clock}`)}">
      <line x1="${f(dot.x)}" y1="${f(dot.y)}" x2="${f(lineEnd.x)}" y2="${f(lineEnd.y)}" stroke="rgba(244,247,255,0.25)"/>
      <circle cx="${f(dot.x)}" cy="${f(dot.y)}" r="${info.selected ? 9 : 7}" fill="${info.isDay ? "var(--pin)" : "var(--bg)"}" stroke="${pin}" stroke-width="2"/>
      <circle cx="${f(dot.x)}" cy="${f(dot.y)}" r="18" fill="transparent"/>
      <text class="code" x="${f(label.x)}" y="${f(label.y - 2)}" text-anchor="${anchor}">${escapeHtml(info.city.code)}</text>
      <text class="time" x="${f(label.x)}" y="${f(label.y + 15)}" text-anchor="${anchor}">${escapeHtml(info.clock)}</text>
    </g>`;
  });

  const yourTime = clockText(snap.shown, systemTimeZone);
  svg.setAttribute("aria-label", `24-hour dial. Your time is ${yourTime}.`);
  svg.innerHTML = `
    <path d="M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}" fill="none" stroke="rgba(157,188,242,0.32)" stroke-width="30"/>
    <path d="M${CX + R},${CY} A${R},${R} 0 0 1 ${CX - R},${CY}" fill="none" stroke="#19223a" stroke-width="30"/>
    ${ticks.join("")}
    ${labels.join("")}
    <text x="${CX}" y="${CY - 24}" text-anchor="middle" fill="var(--muted)" font-size="13" font-weight="600">YOUR TIME</text>
    <text x="${CX}" y="${CY + 24}" text-anchor="middle" fill="var(--pin)" font-size="46" font-weight="300" style="font-variant-numeric:tabular-nums">${escapeHtml(yourTime)}</text>
    <text x="${CX}" y="${CY + 50}" text-anchor="middle" fill="var(--muted)" font-size="12">${escapeHtml(longDate(snap.shown, systemTimeZone))}</text>
    ${cities.join("")}`;
}

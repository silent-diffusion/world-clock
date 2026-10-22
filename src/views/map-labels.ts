// Places the map's city labels so that no two overlap, and none covers a city's dot or the date tags.
// Each label first tries its own side of its dot, then the other sides, then the nearest clear spot further
// out, with a thin line back to its dot.

type Side = "right" | "left" | "above" | "below";
const SIDES: Side[] = ["right", "left", "above", "below"];
const GAP = 3; // space kept between labels, in pixels
const DOT = 7; // half the size of the area kept clear around each dot
const STEP = 6; // how far apart the spots tried further out are, in pixels
const LEADER = 16; // labels further than this from their dot get a line back to it

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const hits = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/** Where a w×h label goes on one side of a dot at (x, y), matching the .side-* rules in styles.css. */
function place(side: Side, x: number, y: number, w: number, h: number): Box {
  if (side === "right") return { x: x + 11, y: y - 19, w, h };
  if (side === "left") return { x: x - 11 - w, y: y - 19, w, h };
  if (side === "above") return { x: x - 14, y: y - 11 - h, w, h };
  return { x: x - 14, y: y + 11, w, h };
}

/** The point of a box nearest to (x, y). */
const nearest = (b: Box, x: number, y: number) => ({
  x: Math.max(b.x, Math.min(x, b.x + b.w)),
  y: Math.max(b.y, Math.min(y, b.y + b.h)),
});

/** Untangles the labels inside a map's pins layer (the live map, or a copy of it in the background picture). */
export function untangleLabels(pins: HTMLElement): void {
  const width = pins.clientWidth;
  const height = pins.clientHeight;
  if (!width || !height) return; // not laid out (a hidden view)
  // The pins layer may be scaled (the background picture shrinks small views), so screen boxes are scaled back.
  const origin = pins.getBoundingClientRect();
  const scale = origin.width / width || 1;

  pins.querySelectorAll(".leader").forEach((line) => line.remove());
  const items = [...pins.querySelectorAll<HTMLElement>(".pin")].map((pin) => ({
    pin,
    chip: pin.querySelector<HTMLElement>(".chip")!,
    x: pin.offsetLeft,
    y: pin.offsetTop,
    side: (SIDES.includes(pin.dataset.side as Side) ? pin.dataset.side : "right") as Side,
  }));

  // Everything a label must stay clear of: every dot, the date tags, and the labels already placed.
  const taken: Box[] = items.map(({ x, y }) => ({ x: x - DOT, y: y - DOT, w: DOT * 2, h: DOT * 2 }));
  const tags = pins.parentElement?.querySelector<HTMLElement>(".date-tags");
  if (tags && !tags.hidden) {
    for (const tag of tags.querySelectorAll<HTMLElement>(".date-tag")) {
      const r = tag.getBoundingClientRect();
      taken.push({ x: (r.left - origin.left) / scale, y: (r.top - origin.top) / scale, w: r.width / scale, h: r.height / scale });
    }
  }
  const inside = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= width && b.y + b.h <= height;
  const free = (b: Box) => inside(b) && !taken.some((t) => hits(b, t));

  // The selected city keeps the best spot; the rest go west to east.
  const order = [...items].sort((a, b) => Number(b.pin.classList.contains("selected")) - Number(a.pin.classList.contains("selected")) || a.x - b.x);
  for (const item of order) {
    const { x, y, chip } = item;
    const w = chip.offsetWidth;
    const h = chip.offsetHeight;

    // Its own side, then the other sides.
    let side = [item.side, ...SIDES.filter((s) => s !== item.side)].find((s) => free(place(s, x, y, w, h)));
    let box = side ? place(side, x, y, w, h) : null;

    // Otherwise the nearest clear spot, searching outward ring by ring from its usual spot.
    if (!box) {
      side = item.side;
      const home = place(side, x, y, w, h);
      const reach = Math.ceil(Math.max(width, height) / STEP);
      for (let ring = 1; ring <= reach && !box; ring++) {
        let bestDistance = Infinity;
        for (let i = -ring; i <= ring; i++) {
          for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
            const spot = { x: home.x + dx * STEP, y: home.y + dy * STEP, w, h };
            if (!free(spot)) continue;
            const near = nearest(spot, x, y);
            const distance = Math.hypot(near.x - x, near.y - y);
            if (distance < bestDistance) {
              bestDistance = distance;
              box = spot;
            }
          }
        }
      }
      box ??= home; // the map is full; nowhere is clear
    }

    for (const s of SIDES) item.pin.classList.toggle(`side-${s}`, s === side);
    const usual = place(side!, x, y, w, h);
    const dx = box.x - usual.x;
    const dy = box.y - usual.y;
    chip.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
    taken.push(box);

    // A line from the dot to a label that had to move away from it.
    const near = nearest(box, x, y);
    const length = Math.hypot(near.x - x, near.y - y);
    if (length > LEADER) {
      const line = document.createElement("span");
      line.className = "leader";
      line.setAttribute("style", `width:${(length - 5).toFixed(1)}px;transform:rotate(${Math.atan2(near.y - y, near.x - x)}rad)`);
      item.pin.prepend(line);
    }
  }
}

import type { BackgroundTile } from "./settings";
import { untangleLabels } from "./views/map-labels";

// Turns a layout of views into a full-screen picture: each view's page is copied into its spot, together
// with the app's styles, inside an SVG <foreignObject>, which the browser can paint onto a canvas.

/** The picture is laid out as if on a screen this many pixels wide, then scaled to the real screen. */
const LAYOUT_WIDTH = 1400;
/** A tile narrower than this shows a scaled-down copy of the full view rather than a cramped one. */
const MIN_TILE_WIDTH = 900;

/** Bits that only make sense in the live window, and notifications (the clock-change banner and tags). */
const PICTURE_STYLES = `
  .wallpaper .details, .wallpaper .dismiss, .wallpaper .add-person, .wallpaper .copy-times,
  .wallpaper .person button, .wallpaper .alert, .wallpaper .chip-tag.change { display: none !important; }
  /* Just the clocks: no keys, headings, city pickers or other controls. */
  .wallpaper .legend, .wallpaper .meet-people, .wallpaper .meet-result .eyebrow, .wallpaper .grip,
  .wallpaper .year-head, .wallpaper .year-bottom { display: none !important; }
  .wallpaper .page { flex: 1; min-height: 0; height: auto; }
  .wallpaper .map-page, .wallpaper .dial-page { padding: 12px; }
  .wallpaper .day-view, .wallpaper .sky-view, .wallpaper .meet-view, .wallpaper .year-view { padding: 16px; overflow: hidden; }

  /* Every view stretches to fill its spot, across and down. */
  .wallpaper .map-box { width: 100%; height: 100%; aspect-ratio: auto; }
  .wallpaper .day-view { display: flex; flex-direction: column; }
  .wallpaper .day-row { flex: 1; height: auto; min-height: 0; container-type: size; }
  .wallpaper .day-row .bar { height: max(14px, 30cqh); border-radius: min(8px, 8cqh); }
  .wallpaper .day-row .time-cell .big { font-size: clamp(20px, 36cqh, 44px); }
  .wallpaper .day-row .city-cell .code, .wallpaper .day-row .city-cell .name { font-size: clamp(12px, 20cqh, 18px); }
  .wallpaper .sky-view { grid-auto-rows: minmax(0, 1fr); align-content: stretch; }
  .wallpaper .sky-card { min-height: 0; }
  .wallpaper .meet-grid { flex: 1; min-height: 0; }
  .wallpaper .meet-row.person-row { flex: 1; height: auto; min-height: 0; }
  .wallpaper .year-calendar, .wallpaper .year-months { flex: 1; min-height: 0; height: 100%; }
  .wallpaper .year-months {
    grid-template-columns: repeat(var(--year-columns, 4), minmax(0, 1fr));
    grid-template-rows: repeat(var(--year-rows, 3), minmax(0, 1fr));
  }
  .wallpaper .year-month { display: flex; flex-direction: column; min-height: 0; container-type: size; }
  .wallpaper .year-month h3 { font-size: clamp(10px, min(6cqh, 4.5cqw), 28px); }
  .wallpaper .year-grid { flex: 1; min-height: 0; grid-template-rows: auto; grid-auto-rows: minmax(0, 1fr); }
  .wallpaper .year-wd { height: auto; font-size: clamp(9px, min(5cqh, 4cqw), 22px); }
  .wallpaper .year-day { height: auto; font-size: clamp(10px, min(7cqh, 5.5cqw), 34px); }
  .wallpaper .year-marks .year-mark { width: clamp(4px, 1.4cqw, 9px); height: clamp(4px, 1.4cqw, 9px); }
`;

/** Months across and down for a Year tile of this shape, keeping each month close to square. */
function yearGrid(width: number, height: number): [number, number] {
  const options: [number, number][] = [[12, 1], [6, 2], [4, 3], [3, 4], [2, 6], [1, 12]];
  const misfit = ([columns, rows]: [number, number]) => Math.abs(Math.log(width / columns / (height / rows) / 1.1));
  return options.reduce((best, option) => (misfit(option) < misfit(best) ? option : best));
}

function appStyles(): string {
  return [...document.styleSheets]
    .map((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      } catch {
        return ""; // a stylesheet from another origin can't be read
      }
    })
    .join("\n");
}

export interface ScreenSize {
  /** Logical (CSS) pixels. */
  width: number;
  height: number;
  /** Physical pixels per logical pixel. */
  scale: number;
}

/** The screen's size from the browser, or the window's when the browser doesn't report one. */
export function browserScreen(): ScreenSize {
  return {
    width: window.screen.width || window.innerWidth,
    height: window.screen.height || window.innerHeight,
    scale: window.devicePixelRatio || 1,
  };
}

/** A PNG of the layout at the given screen size. Every view in it must already be drawn for the moment wanted. */
export async function pictureOfLayout(layout: BackgroundTile[], screen: ScreenSize): Promise<Uint8Array> {
  // Lay out as if on a screen about 1400 px wide, then scale the picture up to the real screen,
  // so labels keep the same proportions on large screens instead of shrinking next to the map.
  const zoom = Math.max(1, screen.width / LAYOUT_WIDTH);
  const width = Math.round(screen.width / zoom);
  const height = Math.round(screen.height / zoom);

  const wrapper = document.createElement("div");
  wrapper.className = "wallpaper";
  wrapper.setAttribute(
    "style",
    `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#0a0f1a;color:#e9eef8;` +
      `font:14px/1.4 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif`,
  );
  const style = document.createElement("style");
  style.textContent = appStyles() + PICTURE_STYLES;
  wrapper.append(style);

  for (const tile of layout) {
    const page = document.querySelector<HTMLElement>(`.page[data-view="${tile.view}"]`);
    if (!page) continue;
    const tileWidth = tile.w * width;
    const tileHeight = tile.h * height;
    const shrink = Math.min(1, tileWidth / MIN_TILE_WIDTH);

    const box = document.createElement("div");
    box.setAttribute(
      "style",
      `position:absolute;left:${tile.x * width}px;top:${tile.y * height}px;width:${tileWidth}px;height:${tileHeight}px;overflow:hidden`,
    );
    const inner = document.createElement("div");
    inner.setAttribute(
      "style",
      `width:${tileWidth / shrink}px;height:${tileHeight / shrink}px;transform:scale(${shrink});transform-origin:0 0;display:flex;flex-direction:column`,
    );
    const copy = page.cloneNode(true) as HTMLElement;
    copy.hidden = false;
    copy.removeAttribute("style");
    // The dial stretches to fill its spot like the map does; the Year months are arranged to suit its shape.
    copy.querySelector("#dial")?.setAttribute("preserveAspectRatio", "none");
    if (tile.view === "year") {
      const [columns, rows] = yearGrid(tileWidth, tileHeight);
      copy.style.setProperty("--year-columns", String(columns));
      copy.style.setProperty("--year-rows", String(rows));
    }
    inner.append(copy);
    box.append(inner);
    wrapper.append(box);
  }

  // Lay the copy out off screen so the map labels can be placed for its size, as in the live map.
  const stage = document.createElement("div");
  stage.setAttribute("style", "position:fixed;left:-100000px;top:0;pointer-events:none");
  stage.setAttribute("aria-hidden", "true");
  stage.append(wrapper);
  document.body.append(stage);
  wrapper.querySelectorAll<HTMLElement>(".pins").forEach(untangleLabels);
  const markup = new XMLSerializer().serializeToString(wrapper);
  stage.remove();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;

  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Couldn't draw the background picture"));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(screen.width * screen.scale);
  canvas.height = Math.round(screen.height * screen.scale);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#0a0f1a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the background picture"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

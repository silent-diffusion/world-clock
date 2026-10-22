import type { BackgroundTile } from "./settings";

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
  .wallpaper .page { flex: 1; min-height: 0; height: auto; }
  .wallpaper .map-page, .wallpaper .dial-page { padding-top: 12px; }
  .wallpaper .day-view, .wallpaper .sky-view, .wallpaper .meet-view { padding-top: 16px; overflow: hidden; }
`;

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
    inner.append(copy);
    box.append(inner);
    wrapper.append(box);
  }

  const markup = new XMLSerializer().serializeToString(wrapper);
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

import type { ViewId } from "./settings";

// Turns a view's page into a full-screen picture: the page is copied, together with the app's styles,
// into an SVG <foreignObject>, which the browser can paint onto a canvas at the screen's resolution.

const LAYOUT_WIDTH = 1400;

/** Bits that only make sense in the live window. */
const HIDE_IN_PICTURE = `
  .wallpaper .details, .wallpaper .dismiss, .wallpaper .add-person, .wallpaper .copy-times,
  .wallpaper .person button { display: none !important; }
  .wallpaper .page { flex: 1; min-height: 0; height: auto; }
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

/** A PNG of the view at the given screen size. The view must already be drawn for the moment wanted. */
export async function pictureOfView(view: ViewId, screen: ScreenSize): Promise<Uint8Array> {
  const page = document.querySelector<HTMLElement>(`.page[data-view="${view}"]`);
  if (!page) throw new Error(`No ${view} view to draw`);

  // Lay the view out as if in a window about 1400 px wide, then scale the picture up to the screen,
  // so labels keep the same proportions on large screens instead of shrinking next to the map.
  const zoom = Math.max(1, screen.width / LAYOUT_WIDTH);
  const width = Math.round(screen.width / zoom);
  const height = Math.round(screen.height / zoom);
  const scale = screen.scale * zoom;

  const wrapper = document.createElement("div");
  wrapper.className = "wallpaper";
  // Leave the bottom free for the taskbar.
  wrapper.setAttribute(
    "style",
    `width:${width}px;height:${height}px;box-sizing:border-box;padding:0 0 56px;display:flex;flex-direction:column;` +
      `background:#0a0f1a;color:#e9eef8;font:14px/1.4 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;overflow:hidden`,
  );
  const style = document.createElement("style");
  style.textContent = appStyles() + HIDE_IN_PICTURE;
  const copy = page.cloneNode(true) as HTMLElement;
  copy.hidden = false;
  copy.removeAttribute("style");
  wrapper.append(style, copy);

  const markup = new XMLSerializer().serializeToString(wrapper);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">` +
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

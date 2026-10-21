import { inTauri, type Settings } from "../settings";
import { escapeHtml, type Snapshot } from "./common";

const strip = document.getElementById("mini")!;
const list = document.getElementById("mini-cities")!;

const CELL_WIDTH = 88;
const STRIP_HEIGHT = 64;
const FULL_MIN_SIZE = { width: 560, height: 400 };

let saved: { width: number; height: number; maximized: boolean } | null = null;

export function isMini(): boolean {
  return document.body.classList.contains("mini-mode");
}

function shownCities(snap: Snapshot, settings: Settings) {
  const pinned = snap.byZone.filter((c) => c.city.pinned);
  return settings.miniPinnedOnly && pinned.length ? pinned : snap.byZone;
}

export function renderMini(snap: Snapshot, settings: Settings): void {
  list.innerHTML = shownCities(snap, settings)
    .map(
      (info) => `<span class="mini-city" title="${escapeHtml(`${info.city.name}, ${info.clock}`)}">
        <span class="code"><span class="mini-dot ${info.isDay ? "day" : "night"}"></span>${escapeHtml(info.city.code)}</span>
        <span class="time">${info.time}<span class="ap">${info.period}M</span></span>
      </span>`,
    )
    .join("");
}

/** Shrinks the window to a strip of times that stays on top, or restores it. */
export async function setMini(on: boolean, snap: Snapshot, settings: Settings): Promise<void> {
  document.body.classList.toggle("mini-mode", on);
  strip.hidden = !on;
  if (on) renderMini(snap, settings);
  if (!inTauri) return;

  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (on) {
    const factor = await win.scaleFactor();
    const size = (await win.innerSize()).toLogical(factor);
    saved = { width: size.width, height: size.height, maximized: await win.isMaximized() };
    if (saved.maximized) await win.unmaximize();
    const width = Math.min(1600, shownCities(snap, settings).length * CELL_WIDTH + 64);
    await win.setMinSize(null);
    await win.setResizable(false);
    await win.setAlwaysOnTop(true);
    await win.setSize(new LogicalSize(width, STRIP_HEIGHT));
  } else {
    await win.setAlwaysOnTop(false);
    await win.setResizable(true);
    await win.setMinSize(new LogicalSize(FULL_MIN_SIZE.width, FULL_MIN_SIZE.height));
    await win.setSize(new LogicalSize(saved?.width ?? 1000, saved?.height ?? 640));
    if (saved?.maximized) await win.maximize();
  }
}

/**
 * The window remembers its last size. If the app was closed while in mini mode, it would reopen as a thin
 * strip with no way back, so open at the normal size instead.
 */
export async function restoreIfTooSmall(): Promise<void> {
  if (!inTauri || window.innerHeight >= FULL_MIN_SIZE.height - 40) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setSize(new LogicalSize(1000, 640));
}

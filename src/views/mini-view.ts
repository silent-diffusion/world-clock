import { inTauri, type Settings } from "../settings";
import { escapeHtml, type Snapshot } from "./common";

const strip = document.getElementById("mini")!;
const list = document.getElementById("mini-cities")!;

const CELL_WIDTH = 88;
// The height of the Windows 11 taskbar, so the strip can sit exactly on top of it.
const STRIP_HEIGHT = 48;
const FULL_MIN_SIZE = { width: 560, height: 400 };

let saved: { width: number; height: number; x: number; y: number; maximized: boolean } | null = null;

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

  const { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (on) {
    const factor = await win.scaleFactor();
    const size = (await win.innerSize()).toLogical(factor);
    const position = await win.outerPosition();
    saved = { width: size.width, height: size.height, x: position.x, y: position.y, maximized: await win.isMaximized() };
    if (saved.maximized) await win.unmaximize();
    const width = Math.min(1600, shownCities(snap, settings).length * CELL_WIDTH + 64);
    await win.setMinSize(null);
    await win.setResizable(false);
    await win.setAlwaysOnTop(true);
    await win.setSize(new LogicalSize(width, STRIP_HEIGHT));

    // Sit where the user last dragged the strip, or on the taskbar the first time.
    const last = loadMiniPosition();
    if (last) {
      await win.setPosition(new PhysicalPosition(last.x, last.y));
    } else {
      const monitor = await currentMonitor();
      if (monitor) {
        const stripHeight = Math.round(STRIP_HEIGHT * monitor.scaleFactor);
        const screenBottom = monitor.position.y + monitor.size.height;
        const workBottom = monitor.workArea.position.y + monitor.workArea.size.height;
        // A bottom taskbar is the strip of screen below the work area; centre the strip in it.
        const taskbar = screenBottom - workBottom;
        const y = taskbar >= stripHeight ? workBottom + Math.round((taskbar - stripHeight) / 2) : screenBottom - stripHeight;
        await win.setPosition(new PhysicalPosition(monitor.position.x + Math.round(8 * monitor.scaleFactor), y));
      }
    }

    // Clicking the taskbar lifts it above "always on top" windows, so keep putting the strip back on top.
    keepOnTop = window.setInterval(() => win.setAlwaysOnTop(true), 1000);
    stopWatchingMoves = await win.onMoved(({ payload }) => {
      localStorage.setItem(MINI_POSITION_KEY, JSON.stringify({ x: payload.x, y: payload.y }));
    });
  } else {
    clearInterval(keepOnTop);
    stopWatchingMoves?.();
    stopWatchingMoves = null;
    await win.setAlwaysOnTop(false);
    await win.setResizable(true);
    await win.setMinSize(new LogicalSize(FULL_MIN_SIZE.width, FULL_MIN_SIZE.height));
    await win.setSize(new LogicalSize(saved?.width ?? 1000, saved?.height ?? 640));
    if (saved) await win.setPosition(new PhysicalPosition(saved.x, saved.y));
    if (saved?.maximized) await win.maximize();
  }
}

const MINI_POSITION_KEY = "world-clock.mini-position";
let keepOnTop: number | undefined;
let stopWatchingMoves: (() => void) | null = null;

function loadMiniPosition(): { x: number; y: number } | null {
  try {
    const p = JSON.parse(localStorage.getItem(MINI_POSITION_KEY) ?? "null");
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

/**
 * The window remembers its last size. If the app was closed while in mini mode, it would reopen as a thin
 * strip with no way back, so open at the normal size instead.
 */
export async function restoreIfTooSmall(): Promise<void> {
  if (!inTauri || window.innerHeight >= FULL_MIN_SIZE.height - 40) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(1000, 640));
  await win.center();
}

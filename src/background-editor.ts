import { FULL_SCREEN_MAP, inTauri, VIEW_INFO, type BackgroundTile, type Settings, type ViewId } from "./settings";

// The desktop background designer: a scaled-down picture of the main display where each view is a box
// you can drag and resize, drawn over your desktop icons and the taskbar so you can arrange around them.

const board = document.getElementById("bg-board")!;
const addSelect = document.getElementById("bg-add") as HTMLSelectElement;
const note = document.getElementById("bg-note")!;

const MIN_SIZE = 0.08; // smallest tile, as a fraction of the screen
const SNAP = 0.01; // positions snap to 1% of the screen
const EDGE = 0.015; // and to the screen edges when this close

interface Desk {
  /** Screen width ÷ height. */
  ratio: number;
  /** Taskbar band, as fractions of the screen; null when there's no bottom taskbar. */
  taskbar: { y: number; h: number } | null;
  icons: { name: string; x: number; y: number; w: number; h: number }[];
}

let desk: Desk = { ratio: 16 / 9, taskbar: { y: 0.955, h: 0.045 }, icons: [] };
let layout: BackgroundTile[] = [];
let save: (layout: BackgroundTile[]) => void = () => {};
let renderPreview: (() => Promise<Uint8Array>) | null = null;
let previewUrl = "";

const snap = (n: number) => Math.round(n / SNAP) * SNAP;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

function escapeHtml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Lets the app shell draw the real picture for the Preview button. */
export function setPreviewRenderer(render: () => Promise<Uint8Array>): void {
  renderPreview = render;
}

/** Shows the saved layout; `onChange` saves an edited one. */
export function showBackgroundEditor(settings: Settings, onChange: (layout: BackgroundTile[]) => void): void {
  layout = settings.wallpaper.layout.map((t) => ({ ...t }));
  save = onChange;
  draw();
  readDesk();
}

/** The main display's shape, its taskbar and the desktop icons (desktop app only). */
async function readDesk(): Promise<void> {
  if (!inTauri) {
    note.textContent = "Drag a view to move it and its corner to resize it. Your desktop icons appear here in the desktop app.";
    return;
  }
  try {
    const { primaryMonitor } = await import("@tauri-apps/api/window");
    const monitor = await primaryMonitor();
    if (monitor) {
      const bottom = monitor.position.y + monitor.size.height;
      const workBottom = monitor.workArea.position.y + monitor.workArea.size.height;
      desk.ratio = monitor.size.width / monitor.size.height;
      desk.taskbar = bottom > workBottom ? { y: (workBottom - monitor.position.y) / monitor.size.height, h: (bottom - workBottom) / monitor.size.height } : null;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const found = await invoke<{ screenWidth: number; screenHeight: number; cellWidth: number; cellHeight: number; icons: { name: string; x: number; y: number }[] }>("desktop_icons");
    desk.icons = found.icons.map((icon) => ({
      name: icon.name,
      x: icon.x / found.screenWidth,
      y: icon.y / found.screenHeight,
      w: found.cellWidth / found.screenWidth,
      h: found.cellHeight / found.screenHeight,
    }));
  } catch (error) {
    console.warn("Couldn't read the desktop layout", error);
    note.textContent = "Drag a view to move it and its corner to resize it. (Your desktop icons couldn't be read this time.)";
  }
  draw();
}

function draw(): void {
  board.style.aspectRatio = String(desk.ratio);
  const preview = previewUrl ? `<img class="bg-preview" src="${previewUrl}" alt="" />` : "";
  const taskbar = desk.taskbar ? `<div class="bg-taskbar" style="top:${pct(desk.taskbar.y)};height:${pct(desk.taskbar.h)}"><span>Taskbar</span></div>` : "";
  const icons = desk.icons
    .map((icon) => `<div class="bg-icon" style="left:${pct(icon.x)};top:${pct(icon.y)};width:${pct(icon.w)};height:${pct(icon.h)}" title="${escapeHtml(icon.name)}"><span>${escapeHtml(icon.name)}</span></div>`)
    .join("");
  const tiles = layout
    .map(
      (tile, i) => `<div class="bg-tile${previewUrl ? " see-through" : ""}" data-index="${i}" tabindex="0" role="group" aria-label="${VIEW_INFO[tile.view].name} view. Arrow keys move it, Shift with arrow keys resizes it."
        style="left:${pct(tile.x)};top:${pct(tile.y)};width:${pct(tile.w)};height:${pct(tile.h)}">
        <span class="bg-tile-name">${VIEW_INFO[tile.view].name}</span>
        <button type="button" class="bg-remove" aria-label="Remove ${VIEW_INFO[tile.view].name} from the background" title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <span class="bg-resize" aria-hidden="true"></span>
      </div>`,
    )
    .join("");
  board.innerHTML = preview + taskbar + icons + tiles;

  const used = new Set(layout.map((t) => t.view));
  addSelect.innerHTML =
    `<option value="">+ Add view</option>` +
    (Object.keys(VIEW_INFO) as ViewId[])
      .filter((id) => !used.has(id))
      .map((id) => `<option value="${id}">${VIEW_INFO[id].name}</option>`)
      .join("");
  addSelect.disabled = used.size === Object.keys(VIEW_INFO).length;
}

function commit(): void {
  previewUrl = "";
  save(layout.map((t) => ({ ...t })));
  draw();
}

function fit(tile: BackgroundTile): void {
  tile.w = Math.min(1, Math.max(MIN_SIZE, tile.w));
  tile.h = Math.min(1, Math.max(MIN_SIZE, tile.h));
  tile.x = Math.min(1 - tile.w, Math.max(0, tile.x));
  tile.y = Math.min(1 - tile.h, Math.max(0, tile.y));
  // Stick to the screen edges when close.
  if (tile.x < EDGE) tile.x = 0;
  if (tile.y < EDGE) tile.y = 0;
  if (1 - (tile.x + tile.w) < EDGE) tile.x = 1 - tile.w;
  if (1 - (tile.y + tile.h) < EDGE) tile.y = 1 - tile.h;
}

// ---- Dragging and resizing ----

let drag: { index: number; mode: "move" | "resize"; startX: number; startY: number; start: BackgroundTile; el: HTMLElement } | null = null;

board.addEventListener("pointerdown", (event) => {
  const target = event.target as Element;
  if (target.closest(".bg-remove")) return;
  const el = target.closest<HTMLElement>(".bg-tile");
  if (!el) return;
  event.preventDefault();
  el.focus();
  const index = Number(el.dataset.index);
  drag = { index, mode: target.closest(".bg-resize") ? "resize" : "move", startX: event.clientX, startY: event.clientY, start: { ...layout[index] }, el };
  board.setPointerCapture(event.pointerId);
});

board.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const rect = board.getBoundingClientRect();
  const dx = (event.clientX - drag.startX) / rect.width;
  const dy = (event.clientY - drag.startY) / rect.height;
  const tile = layout[drag.index];
  if (drag.mode === "move") {
    tile.x = snap(drag.start.x + dx);
    tile.y = snap(drag.start.y + dy);
  } else {
    tile.w = snap(drag.start.w + dx);
    tile.h = snap(drag.start.h + dy);
  }
  fit(tile);
  Object.assign(drag.el.style, { left: pct(tile.x), top: pct(tile.y), width: pct(tile.w), height: pct(tile.h) });
});

function endDrag(): void {
  if (!drag) return;
  const { index, start } = drag;
  drag = null;
  const tile = layout[index];
  if (tile.x !== start.x || tile.y !== start.y || tile.w !== start.w || tile.h !== start.h) commit();
}
board.addEventListener("pointerup", endDrag);
board.addEventListener("pointercancel", endDrag);

// Keyboard: arrows move the focused view by 1%, Shift+arrows resize it.
board.addEventListener("keydown", (event) => {
  const el = (event.target as Element).closest<HTMLElement>(".bg-tile");
  const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!el || !(event.key in step)) return;
  event.preventDefault();
  event.stopPropagation();
  const index = Number(el.dataset.index);
  const tile = layout[index];
  const [sx, sy] = step[event.key];
  if (event.shiftKey) {
    tile.w = snap(tile.w + sx * SNAP);
    tile.h = snap(tile.h + sy * SNAP);
  } else {
    tile.x = snap(tile.x + sx * SNAP);
    tile.y = snap(tile.y + sy * SNAP);
  }
  fit(tile);
  commit();
  board.querySelector<HTMLElement>(`.bg-tile[data-index="${index}"]`)?.focus();
});

board.addEventListener("click", (event) => {
  const remove = (event.target as Element).closest(".bg-remove");
  if (!remove) return;
  const index = Number(remove.closest<HTMLElement>(".bg-tile")!.dataset.index);
  layout.splice(index, 1);
  if (!layout.length) layout.push({ ...FULL_SCREEN_MAP });
  commit();
});

// ---- Toolbar ----

addSelect.addEventListener("change", () => {
  const view = addSelect.value as ViewId;
  if (!view) return;
  // New views start in the middle, at a third of the screen, ready to be moved.
  layout.push({ view, x: 0.33, y: 0.3, w: 0.34, h: 0.34 });
  commit();
  board.querySelector<HTMLElement>(`.bg-tile[data-index="${layout.length - 1}"]`)?.focus();
});

document.getElementById("bg-reset")!.addEventListener("click", () => {
  layout = [{ ...FULL_SCREEN_MAP }];
  commit();
});

document.getElementById("bg-icons")!.addEventListener("click", () => readDesk());

document.getElementById("bg-preview")!.addEventListener("click", async () => {
  if (!renderPreview) return;
  const button = document.getElementById("bg-preview") as HTMLButtonElement;
  button.disabled = true;
  try {
    const png = await renderPreview();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    draw();
  } finally {
    button.disabled = false;
  }
});

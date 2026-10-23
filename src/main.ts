import { cityKey } from "./cities";
import { applyTheme, firstRun, inTauri, loadSettings, onSettingsChanged, VIEW_INFO, type BackgroundTile, type Settings, type ViewId } from "./settings";
import { setPreviewRenderer } from "./background-editor";
import { refreshSettingsPage, reportWallpaper, settingsGoBack } from "./settings-page";
import { onStateChange, setState, state } from "./state";
import { clockText, formatShift, longDate, systemTimeZone } from "./time";
import { escapeHtml, snapshot, type Snapshot } from "./views/common";
import { renderClock } from "./views/clock-view";
import { renderDay } from "./views/day-view";
import { renderDial } from "./views/dial-view";
import { renderMap } from "./views/map-view";
import { renderMeet } from "./views/meet-view";
import { isMini, renderMini, restoreIfTooSmall, setMini } from "./views/mini-view";
import { renderSky } from "./views/sky-view";
import { renderYear, resetYear, yearSummary } from "./views/year-view";
import { browserScreen, pictureOfLayout, type ScreenSize } from "./wallpaper";

const $ = (id: string) => document.getElementById(id)!;
const clock = $("clock");
const track = $("track");
const footer = $("footer");
const badge = $("badge");
const settingsView = $("settings-view");

let settings: Settings = loadSettings();
applyTheme(settings.theme); // before anything is drawn
let settingsOpen = false;

const STEP_MINUTES = 15; // 15-minute steps also land on half- and quarter-hour time zones
const MAX_OFFSET_MINUTES = 7 * 24 * 60;

function enabledViews(): ViewId[] {
  return settings.views.filter((v) => v.on).map((v) => v.id);
}

// ---- Drawing ----

/** A redraw skipped while the window was hidden, to make when it's shown again. */
let renderOwed = false;
/** The badge as last drawn: it's a live region, so it's only rewritten when it changes, or it would be read out again. */
let badgeHtml = "";

function render(): void {
  if (document.hidden) {
    renderOwed = true;
    return;
  }
  renderOwed = false;
  const views = enabledViews();
  if (!views.includes(state.view)) state.view = "map";
  // Forget the selection if that city was removed in Settings.
  if (state.selectedKey && !settings.cities.some((c) => cityKey(c) === state.selectedKey)) {
    Object.assign(state, { selectedKey: null, offsetMinutes: 0, detailsOpen: false });
  }

  const snap = snapshot(settings);
  document.body.classList.toggle("shifted", snap.shifted);
  if (isMini()) {
    renderMini(snap, settings);
    return;
  }

  for (const page of track.querySelectorAll<HTMLElement>(".page")) {
    const id = page.dataset.view as ViewId;
    page.hidden = !views.includes(id);
    page.inert = id !== state.view; // the views off to the side stay out of the Tab order
    page.style.order = String(views.indexOf(id));
  }
  clock.scrollLeft = 0; // see the scroll listener below
  if (!track.classList.contains("dragging")) track.style.transform = `translateX(${-views.indexOf(state.view) * 100}%)`;

  for (const view of views) drawView(view, snap);

  // Tabs and page dots.
  $("view-tabs").innerHTML = views
    .map((id) => `<button type="button" role="tab" data-go="${id}" aria-controls="page-${id}" aria-selected="${id === state.view}">${VIEW_INFO[id].name}</button>`)
    .join("");
  $("dots").innerHTML = views.map((id) => `<span class="${id === state.view ? "active" : ""}"></span>`).join("");

  $("date-line").textContent = `${longDate(snap.shown, systemTimeZone)} · ${clockText(snap.shown, systemTimeZone)}`;

  // Badge: how far time has moved, or which city is selected.
  const selected = snap.cities.find((c) => c.selected);
  let main = "";
  let hint = "";
  if (snap.shifted) {
    main = formatShift(state.offsetMinutes);
    hint = "from now · Esc returns to now";
  } else if (selected) {
    main = selected.city.name;
    hint = settings.extras.relative ? "Gaps are measured from here" : "Scroll to change the time";
  } else if (settings.extras.relative && state.view === "map") {
    main = "Relative to your time";
    hint = "Click a city to compare from there";
  }
  badge.hidden = !main || settingsOpen;
  const html = `<span class="badge-main">${escapeHtml(main)}</span><span class="badge-hint">${hint}</span>`;
  if (html !== badgeHtml) badge.innerHTML = badgeHtml = html;

  $("hint").textContent =
    state.view === "year"
      ? "Click a day to see it in every view"
      : state.view === "clock"
        ? "Your own time · add it to the desktop in Settings → Desktop background"
        : selected
        ? "Scroll or ↑ ↓ to move time · ← → for other views"
        : "Click a city, then scroll to see another time";
  const asleep = snap.cities.filter((c) => c.asleep).length;
  const daylight = snap.cities.filter((c) => c.isDay).length;
  $("summary").textContent = state.view === "year"
    ? yearSummary(snap, settings)
    : settings.extras.dimAsleep
    ? `${snap.cities.length - asleep} awake · ${asleep} asleep`
    : `${daylight} of ${snap.cities.length} cities in daylight`;
}

function drawView(view: ViewId, snap: Snapshot, picture = false): void {
  if (view === "map") renderMap(snap, settings, picture);
  else if (view === "day") renderDay(snap, settings);
  else if (view === "sky") renderSky(snap);
  else if (view === "dial") renderDial(snap);
  else if (view === "meet") renderMeet(snap, settings);
  else if (view === "year") renderYear(snap, settings, picture);
  else renderClock(snap);
}

// ---- Desktop background ----

const ORIGINAL_WALLPAPER_KEY = "world-clock.original-wallpaper";
let wallpaperWasOn = settings.wallpaper.on;
/** The redraw in progress, and whether another was asked for meanwhile. */
let wallpaperBusy: Promise<void> | null = null;
let wallpaperPending = false;
/** Settings changes come in bursts (typing, dragging), so the background waits for them to settle. */
let wallpaperDelay: number | undefined;

/** Draws a layout's views for right now (no selection or scrubbing), starts its picture, and puts the live views back. */
function drawPicture(layout: BackgroundTile[], screen: ScreenSize): Promise<Uint8Array> {
  const live = { selectedKey: state.selectedKey, offsetMinutes: state.offsetMinutes, detailsOpen: state.detailsOpen };
  Object.assign(state, { selectedKey: null, offsetMinutes: 0, detailsOpen: false });
  try {
    const snap = snapshot(settings);
    for (const view of new Set(layout.map((tile) => tile.view))) drawView(view, snap, true);
    return pictureOfLayout(layout, screen); // copies the pages before its first await
  } finally {
    Object.assign(state, live);
    render(); // skipped while the window is hidden, and made up for when it's shown
  }
}

/** Redraws the desktop background; a call while one is in progress runs again once it finishes. */
function updateWallpaper(): void {
  if (!inTauri || !settings.wallpaper.on) return;
  if (wallpaperBusy) {
    wallpaperPending = true;
    return;
  }
  wallpaperBusy = setWallpaper().finally(() => {
    wallpaperBusy = null;
    if (wallpaperPending) {
      wallpaperPending = false;
      updateWallpaper();
    }
  });
}

/** Draws the background layout and hands it to Windows. */
async function setWallpaper(): Promise<void> {
  try {
    const screen = await monitorSize();
    const picture = drawPicture(settings.wallpaper.layout, screen);
    const { invoke } = await import("@tauri-apps/api/core");
    const png = await picture;
    // Unless it was turned off meanwhile.
    if (settings.wallpaper.on) {
      await invoke("set_wallpaper", png);
      reportWallpaper({ at: new Date(), error: "" });
    }
  } catch (error) {
    console.warn("Couldn't update the desktop background", error);
    reportWallpaper({ at: new Date(), error: error instanceof Error ? error.message : String(error) });
  }
}

/** The size of the main (primary) display, which the background is fitted to. */
async function monitorSize(): Promise<ScreenSize> {
  const { currentMonitor, primaryMonitor } = await import("@tauri-apps/api/window");
  const monitor = (await primaryMonitor().catch(() => null)) ?? (await currentMonitor().catch(() => null));
  if (!monitor) return browserScreen();
  return {
    width: Math.round(monitor.size.width / monitor.scaleFactor),
    height: Math.round(monitor.size.height / monitor.scaleFactor),
    scale: monitor.scaleFactor,
  };
}

/** The live preview in the background designer, drawn the same way as the real picture. */
setPreviewRenderer(async (layout, pixelWidth) => {
  const screen = inTauri ? await monitorSize() : browserScreen();
  // Only as many pixels as the designer shows.
  return drawPicture(layout, { ...screen, scale: Math.min(screen.scale, pixelWidth / screen.width) });
});

/** Reacts to the setting being turned on or off: keep running when closed, and save or restore the old background. */
async function syncWallpaperMode(): Promise<void> {
  if (!inTauri) return;
  const on = settings.wallpaper.on;
  if (on !== wallpaperWasOn) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_keep_running", { on });
    if (on) {
      let saved = false;
      try {
        const current = await invoke<string>("current_wallpaper");
        if (current && !/world-clock-[ab].png$/i.test(current)) localStorage.setItem(ORIGINAL_WALLPAPER_KEY, current);
        saved = Boolean(current);
      } catch (error) {
        console.warn("Couldn't save the current background", error);
      }
      reportWallpaper({ originalLost: !saved });
    } else {
      await wallpaperBusy; // so a redraw in progress can't land after the restore
      const original = localStorage.getItem(ORIGINAL_WALLPAPER_KEY);
      if (original) await invoke("restore_wallpaper", { path: original }).catch((error) => console.warn("Couldn't restore the background", error));
    }
    wallpaperWasOn = on;
  }
  clearTimeout(wallpaperDelay);
  wallpaperDelay = window.setTimeout(updateWallpaper, 500);
}

// ---- Selecting and scrubbing time ----

function toggleCity(key: string): void {
  if (state.selectedKey === key) clearSelection();
  else setState({ selectedKey: key, detailsOpen: false });
}

function clearSelection(): void {
  setState({ selectedKey: null, offsetMinutes: 0, detailsOpen: false });
}

function shiftBy(minutes: number): void {
  const next = state.offsetMinutes + minutes;
  // Scrolling stays within a week of now, but a day picked further out in the Year view can still be scrolled around.
  const limit = Math.max(MAX_OFFSET_MINUTES, Math.abs(state.offsetMinutes));
  setState({ offsetMinutes: Math.max(-limit, Math.min(limit, next)) });
}

function go(delta: number): void {
  const views = enabledViews();
  const index = Math.max(0, Math.min(views.length - 1, views.indexOf(state.view) + delta));
  setState({ view: views[index] });
}

// The views slide by transform, never by scrolling; focusing something on another page would otherwise
// scroll the container sideways and leave the views misaligned.
clock.addEventListener("scroll", () => {
  clock.scrollLeft = 0;
  clock.scrollTop = 0;
});

// A swipe ends with a click on whatever was under the pointer; swallow it.
let justDragged = false;
clock.addEventListener(
  "click",
  (event) => {
    if (!justDragged) return;
    justDragged = false;
    event.stopPropagation();
    event.preventDefault();
  },
  true,
);

clock.addEventListener("click", (event) => {
  const target = event.target as Element;
  const item = target.closest<HTMLElement>("[data-key]");
  if (item && !item.closest(".pins")) {
    toggleCity(item.dataset.key!);
    return;
  }
  // A click on empty space returns to now (but not inside the Meet or Year views, which are full of controls).
  if (!item && !target.closest("button, select, input, label, .details, .alert, .meet-view, .year-view") && state.selectedKey) clearSelection();
});

/** Whether the wheel should scroll something under the pointer (a long list or calendar) rather than move time. */
function canScroll(target: Element, deltaY: number): boolean {
  const page = target.closest(".page");
  if (!page) return false;
  for (let el: Element | null = target; el; el = el === page ? null : el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    if (deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
  }
  return false;
}

let wheelDistance = 0;
// A trackpad swipe keeps sending "momentum" wheel events after the fingers lift. One gesture moves one
// page: after a page turn, sideways events are ignored until they stop arriving for a moment.
let swipeDistance = 0;
let swipeLocked = false;
let swipeQuiet: number | undefined;
clock.addEventListener(
  "wheel",
  (event) => {
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : 1;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      // Sideways scrolling (trackpads, tilt wheels) swipes between views.
      event.preventDefault();
      clearTimeout(swipeQuiet);
      swipeQuiet = window.setTimeout(() => {
        swipeLocked = false;
        swipeDistance = 0;
      }, 250);
      if (swipeLocked) return;
      swipeDistance += event.deltaX * lines;
      if (Math.abs(swipeDistance) > 60) {
        go(swipeDistance > 0 ? 1 : -1);
        swipeLocked = true;
      }
      return;
    }
    if (!state.selectedKey) return;
    if (canScroll(event.target as Element, event.deltaY)) {
      wheelDistance = 0;
      return;
    }
    event.preventDefault();
    wheelDistance += event.deltaY * lines;
    const steps = Math.trunc(wheelDistance / 100); // one mouse-wheel notch; touchpads add up smaller moves
    if (steps === 0) return;
    wheelDistance -= steps * 100;
    shiftBy(-steps * STEP_MINUTES); // scrolling up moves time forward
  },
  { passive: false },
);

// Dragging sideways (mouse, pen or touch) swipes between views.
let drag: { x: number; y: number; moved: boolean } | null = null;
clock.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  // Leave rows that can be dragged into a new order (and form fields) to themselves.
  if ((event.target as Element).closest("input, select, textarea, .details, [draggable='true']")) return;
  drag = { x: event.clientX, y: event.clientY, moved: false };
});
clock.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved) {
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    drag.moved = true;
    track.classList.add("dragging");
    clock.setPointerCapture(event.pointerId);
  }
  const index = enabledViews().indexOf(state.view);
  track.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`;
});
function endDrag(event: PointerEvent): void {
  if (!drag) return;
  const { moved, x } = drag;
  drag = null;
  if (!moved) return;
  justDragged = true;
  setTimeout(() => (justDragged = false), 0);
  track.classList.remove("dragging");
  const dx = event.clientX - x;
  if (dx < -80) go(1);
  else if (dx > 80) go(-1);
  else render();
}
clock.addEventListener("pointerup", endDrag);
clock.addEventListener("pointercancel", endDrag);

$("view-tabs").addEventListener("click", (event) => {
  const tab = (event.target as Element).closest<HTMLElement>("[data-go]");
  if (tab) setState({ view: tab.dataset.go as ViewId });
});

document.addEventListener("keydown", (event) => {
  const target = event.target instanceof Element ? event.target : document.body;
  // Switches are inputs too, but Esc and the arrow keys mean nothing to them.
  const typing = Boolean(target.closest("input:not([type=checkbox]):not([type=radio]), select, textarea"));
  if (settingsOpen) {
    if (event.key === "Escape" && !typing && !settingsGoBack()) closeSettings();
    return;
  }
  if (isMini()) return;
  const dialCity = target.closest<HTMLElement>("#dial [data-key]");
  if (dialCity && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    toggleCity(dialCity.dataset.key!);
    return;
  }
  // Esc closes the map's details card even from its note, which keeps what was typed.
  if (event.key === "Escape" && state.detailsOpen && target.closest("#details")) {
    (target as HTMLElement).blur(); // saves the note
    setState({ detailsOpen: false });
    document.querySelector<HTMLElement>(`.pin[data-key="${CSS.escape(state.selectedKey ?? "")}"]`)?.focus();
    return;
  }
  if (typing) return;
  if (event.key === "Escape") {
    if (state.detailsOpen) {
      setState({ detailsOpen: false });
      return;
    }
    const browsing = resetYear(); // a year reached with the Year view's arrows
    if (state.selectedKey) clearSelection();
    else if (state.offsetMinutes) setState({ offsetMinutes: 0 }); // a day picked in the Year view
    else if (browsing) setState({});
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    go(event.key === "ArrowRight" ? 1 : -1);
    return;
  }
  if (!state.selectedKey) return;
  const steps: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 4, PageDown: -4 };
  if (event.key in steps) {
    event.preventDefault();
    shiftBy(steps[event.key] * STEP_MINUTES);
  }
});

// ---- Settings and mini mode ----

function openSettings(): void {
  settingsOpen = true;
  refreshSettingsPage();
  settingsView.hidden = false;
  clock.hidden = true;
  footer.hidden = true;
  badge.hidden = true;
  $("settings-back").focus();
}

function closeSettings(): void {
  settingsOpen = false;
  settingsView.hidden = true;
  clock.hidden = false;
  footer.hidden = false;
  render();
  // Focus was in Settings (now hidden) or nowhere: put it on the current view's tab.
  if (document.activeElement === document.body || settingsView.contains(document.activeElement)) {
    $("view-tabs").querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }
}

$("settings-button").addEventListener("click", () => (settingsOpen ? closeSettings() : openSettings()));
// Back goes up one level in the Settings menu, and closes Settings from the top.
$("settings-back").addEventListener("click", () => {
  if (!settingsGoBack()) closeSettings();
});

async function enterMini(): Promise<void> {
  if (settingsOpen) closeSettings();
  clearSelection(); // the strip has no way to show a moved time, or to return to now
  await setMini(true, snapshot(settings), settings);
}
$("mini-button").addEventListener("click", enterMini);
$("open-mini").addEventListener("click", enterMini);
$("mini-expand").addEventListener("click", async () => {
  await setMini(false, snapshot(settings), settings);
  render();
});

// ---- Auto-hiding top bar ----
// The window has no title bar. Ours slides down when the mouse reaches the top edge (or a keyboard user
// tabs into it, or a finger touches the top edge) and slides away again shortly after the mouse moves
// down or leaves the window. On the very first run it shows itself for a few seconds, so it's found.

const bar = $("app-bar");
const REVEAL_ZONE = 24; // px from the top of the window
let hideTimer: number | undefined;
let introducing = false;

function showBar(): void {
  clearTimeout(hideTimer);
  bar.classList.add("shown");
}

function scheduleHide(): void {
  if (introducing) return;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!bar.matches(":hover") && !bar.querySelector(":focus-visible")) bar.classList.remove("shown");
  }, 400);
}

document.addEventListener("mousemove", (event) => {
  if (isMini()) return;
  if (event.clientY <= REVEAL_ZONE) showBar();
  else if (bar.classList.contains("shown") && event.clientY > bar.offsetHeight) scheduleHide();
});
document.addEventListener("pointerdown", (event) => {
  if (isMini() || event.pointerType === "mouse") return;
  if (event.clientY <= REVEAL_ZONE) showBar();
  else if (bar.classList.contains("shown") && event.clientY > bar.offsetHeight) scheduleHide();
});
document.documentElement.addEventListener("mouseleave", scheduleHide);
bar.addEventListener("focusin", showBar);
bar.addEventListener("focusout", scheduleHide);
if (firstRun) {
  introducing = true;
  showBar();
  setTimeout(() => {
    introducing = false;
    scheduleHide();
  }, 4000);
}

async function setUpWindowControls(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  const maximize = $("maximize");

  document.querySelector<HTMLElement>(".window-controls")!.hidden = false;
  $("minimize").addEventListener("click", () => appWindow.minimize());
  maximize.addEventListener("click", () => appWindow.toggleMaximize());
  $("close").addEventListener("click", () => appWindow.close());

  // Swap the maximize icon for a "restore" icon while the window is maximized.
  const square = maximize.innerHTML;
  const restore = `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
  const syncMaximize = async () => {
    const maximized = await appWindow.isMaximized();
    maximize.innerHTML = maximized ? restore : square;
    maximize.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
    maximize.title = maximized ? "Restore" : "Maximize";
  };
  appWindow.onResized(syncMaximize);
  syncMaximize();
}

// Loaded lazily so the browser preview (npm run dev) doesn't touch the Tauri plugins.
async function setUpDesktop(): Promise<void> {
  await restoreIfTooSmall();
  setUpWindowControls();

  // The desktop background: redraw on every minute from the app's own clock, which keeps ticking while
  // the window is hidden. Started at sign-in with the background on, the window stays out of the way.
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  listen("minute", () => {
    tick();
    updateWallpaper();
  });
  if (settings.wallpaper.on) {
    await invoke("set_keep_running", { on: true });
    if (await invoke<boolean>("launched_at_login")) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    }
    updateWallpaper();
  }

  const { scheduleUpdateChecks } = await import("./updates");
  scheduleUpdateChecks(() => settings.autoCheckUpdates);

  // Start at sign-in by default; after the first run, the setting is whatever the user chose.
  const FIRST_RUN_KEY = "world-clock.autostart-initialized";
  if (!localStorage.getItem(FIRST_RUN_KEY)) {
    const { enable } = await import("@tauri-apps/plugin-autostart");
    try {
      await enable();
      localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch (error) {
      console.warn("Couldn't turn on start at sign-in", error);
    }
  }
}

// ---- Start ----

onStateChange(render);
onSettingsChanged(() => {
  settings = loadSettings();
  applyTheme(settings.theme);
  render();
  syncWallpaperMode();
});
if (inTauri) setUpDesktop();

// Redraw whenever the minute changes. Checking often (rather than sleeping a full minute)
// keeps the clock right after the computer wakes from sleep.
let lastMinute = -1;
function tick(): void {
  const minute = Math.floor(Date.now() / 60000);
  if (minute !== lastMinute) {
    lastMinute = minute;
    render();
  }
}
tick();
setInterval(tick, 5000);
document.addEventListener("visibilitychange", () => {
  tick();
  if (renderOwed) render();
});

import { inTauri, type ScreenShape } from "./settings";
import { browserScreen, type ScreenSize } from "./wallpaper";

// The screens the desktop background is drawn for. Tauri knows each screen's scale and taskbar; Windows'
// own wallpaper list knows which slot to set its picture in. Both give positions in physical pixels, which
// is how the two are matched up.

export interface Screen {
  /** Its slot in Windows' wallpaper list, or -1 when screens can't be set one by one (then one picture fits all). */
  index: number;
  shape: ScreenShape;
  primary: boolean;
  /** What its picture is drawn at. */
  size: ScreenSize;
  /** The taskbar along its bottom, as fractions of the screen; null when there's none there. */
  taskbar: { y: number; h: number } | null;
}

export const shapeOf = (width: number, height: number): ScreenShape => (height > width ? "portrait" : "landscape");

interface ShellMonitor {
  index: number;
  x: number;
  y: number;
}

/** Every screen that's on, the main one first. In the browser, one screen the size of this one. */
export async function listScreens(): Promise<Screen[]> {
  if (!inTauri) {
    const size = browserScreen();
    return [{ index: -1, shape: shapeOf(size.width, size.height), primary: true, size, taskbar: { y: 0.955, h: 0.045 } }];
  }
  const { availableMonitors, primaryMonitor } = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");
  const [monitors, main, shell] = await Promise.all([
    availableMonitors(),
    primaryMonitor(),
    invoke<ShellMonitor[]>("monitors").catch((error) => {
      console.warn("Couldn't list the screens for their own backgrounds", error);
      return null;
    }),
  ]);
  const screens = monitors.map((m): Screen => {
    const bottom = m.position.y + m.size.height;
    const workBottom = m.workArea.position.y + m.workArea.size.height;
    return {
      index: shell?.find((s) => s.x === m.position.x && s.y === m.position.y)?.index ?? -1,
      shape: shapeOf(m.size.width, m.size.height),
      primary: Boolean(main && m.position.x === main.position.x && m.position.y === main.position.y),
      size: { width: Math.round(m.size.width / m.scaleFactor), height: Math.round(m.size.height / m.scaleFactor), scale: m.scaleFactor },
      taskbar: bottom > workBottom ? { y: (workBottom - m.position.y) / m.size.height, h: (bottom - workBottom) / m.size.height } : null,
    };
  });
  screens.sort((a, b) => Number(b.primary) - Number(a.primary));
  // Without Windows' list (or if none match it), the main screen's picture is set for every screen, as before 1.6.
  const matched = screens.filter((s) => s.index >= 0);
  return matched.length ? matched : screens.slice(0, 1).map((s) => ({ ...s, index: -1 }));
}

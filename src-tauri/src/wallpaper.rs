//! "Set as background": the app draws a view as a picture once a minute and hands it to Windows as the
//! desktop wallpaper. Nothing runs between updates, which keeps it light on power. With several screens,
//! each gets its own picture through the shell's IDesktopWallpaper interface.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// While the background is on, closing the window hides it instead of quitting, so updates continue.
pub struct KeepRunning(pub AtomicBool);

/// Windows caches the wallpaper by file name, so the picture alternates between two files.
static USE_SECOND_FILE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn set_wallpaper(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err("Expected the wallpaper image as raw bytes.".into());
    };
    let dir = app.path().app_local_data_dir().map_err(text)?.join("wallpaper");
    std::fs::create_dir_all(&dir).map_err(text)?;
    let second = USE_SECOND_FILE.fetch_xor(true, Ordering::SeqCst);
    let path = dir.join(if second { "world-clock-b.png" } else { "world-clock-a.png" });
    std::fs::write(&path, png).map_err(text)?;
    apply(&path.to_string_lossy(), false)
}

/// The wallpaper Windows is showing now, so it can be put back when the setting is turned off.
#[tauri::command]
pub async fn current_wallpaper() -> Result<String, String> {
    read_current()
}

/// Puts back a wallpaper (the one from before "Set as background" was turned on) and saves it.
#[tauri::command]
pub async fn restore_wallpaper(path: String) -> Result<(), String> {
    // An empty path is Windows' "no picture" and touches no file.
    if !path.is_empty() && !is_local_image(&path) {
        return Err("That isn't a picture on this computer.".into());
    }
    apply(&path, true)
}

/// A picture file on a lettered drive. Network paths are refused: opening one makes Windows send the
/// user's credentials to that server.
fn is_local_image(path: &str) -> bool {
    let b = path.as_bytes();
    let on_drive = b.len() > 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'\\' | b'/');
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    let image = matches!(
        extension.as_deref(),
        Some("bmp" | "png" | "jpg" | "jpeg" | "gif" | "tif" | "tiff" | "webp")
    );
    // symlink_metadata, so a link pointing at a network share isn't followed or accepted.
    on_drive && image && std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file())
}

/// A screen Windows shows a wallpaper on. `index` is its place in Windows' own list, which is how the page
/// names it back; position and size are in physical pixels on the virtual screen.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Monitor {
    pub index: u32,
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// The wallpaper each screen showed, and how pictures were placed (fill, fit, span...), to put back later.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWallpapers {
    pub position: i32,
    pub monitors: Vec<SavedWallpaper>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWallpaper {
    pub id: String,
    pub path: String,
}

/// At most this many screens get a picture of their own; each alternates between two files, as above.
const MAX_SCREENS: usize = 16;
static SECOND_FILE_FOR: Mutex<[bool; MAX_SCREENS]> = Mutex::new([false; MAX_SCREENS]);

/// The screens that are on, in Windows' order.
#[tauri::command]
pub async fn monitors() -> Result<Vec<Monitor>, String> {
    shell::run(shell::monitors)
}

/// Sets one screen's picture. The PNG is the body; the "monitor" header is that screen's index from `monitors`,
/// so the page never names a screen Windows didn't list.
#[tauri::command]
pub async fn set_monitor_wallpaper(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err("Expected the wallpaper image as raw bytes.".into());
    };
    let index: u32 = request
        .headers()
        .get("monitor")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .filter(|&i: &u32| (i as usize) < MAX_SCREENS)
        .ok_or("Which screen the picture is for is missing.")?;
    let second = {
        let mut slots = SECOND_FILE_FOR.lock().map_err(text)?;
        slots[index as usize] = !slots[index as usize];
        slots[index as usize]
    };
    let dir = app.path().app_local_data_dir().map_err(text)?.join("wallpaper");
    std::fs::create_dir_all(&dir).map_err(text)?;
    let path = dir.join(format!("world-clock-{index}-{}.png", if second { "b" } else { "a" }));
    std::fs::write(&path, png).map_err(text)?;
    let path = path.to_string_lossy().into_owned();
    shell::run(move || shell::set(index, &path))
}

/// Every screen's wallpaper now, so each can be put back when the setting is turned off.
#[tauri::command]
pub async fn current_wallpapers() -> Result<SavedWallpapers, String> {
    shell::run(shell::current)
}

/// Puts back each screen's wallpaper from `current_wallpapers`. Screens that are no longer connected, and
/// pictures that aren't on this computer, are skipped.
#[tauri::command]
pub async fn restore_wallpapers(saved: SavedWallpapers) -> Result<(), String> {
    shell::run(move || shell::restore(saved))
}

#[cfg(windows)]
mod shell {
    use super::{is_local_image, Monitor, SavedWallpaper, SavedWallpapers};
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{DesktopWallpaper, IDesktopWallpaper, DESKTOP_WALLPAPER_POSITION, DWPOS_FILL, DWPOS_SPAN};

    fn text(e: windows::core::Error) -> String {
        e.message()
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Runs `f` on a thread of its own with COM started, as the shell's wallpaper object needs.
    pub fn run<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
        std::thread::spawn(move || unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(text)?;
            let result = f();
            CoUninitialize();
            result
        })
        .join()
        .map_err(|_| "Talking to the Windows desktop failed.".to_string())?
    }

    fn desktop() -> Result<IDesktopWallpaper, String> {
        unsafe { CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL).map_err(text) }
    }

    /// Each screen's id, in Windows' order. Windows allocates the strings; they're freed here.
    fn ids(dw: &IDesktopWallpaper) -> Result<Vec<String>, String> {
        unsafe {
            let count = dw.GetMonitorDevicePathCount().map_err(text)?;
            let mut ids = Vec::new();
            for i in 0..count {
                let id = dw.GetMonitorDevicePathAt(i).map_err(text)?;
                ids.push(id.to_string().unwrap_or_default());
                CoTaskMemFree(Some(id.0 as _));
            }
            Ok(ids)
        }
    }

    pub fn monitors() -> Result<Vec<Monitor>, String> {
        let dw = desktop()?;
        let mut list = Vec::new();
        for (index, id) in ids(&dw)?.into_iter().enumerate() {
            // A screen that's connected but switched off has no rectangle.
            let id_wide = wide(&id);
            let Ok(r) = (unsafe { dw.GetMonitorRECT(PCWSTR(id_wide.as_ptr())) }) else { continue };
            if r.right > r.left && r.bottom > r.top {
                list.push(Monitor { index: index as u32, id, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
            }
        }
        Ok(list)
    }

    pub fn set(index: u32, path: &str) -> Result<(), String> {
        let dw = desktop()?;
        let id = ids(&dw)?.into_iter().nth(index as usize).ok_or("That screen is no longer connected.")?;
        let (id_wide, path_wide) = (wide(&id), wide(path));
        unsafe {
            // Spanning one picture across every screen would undo the per-screen pictures.
            if dw.GetPosition().map_err(text)? == DWPOS_SPAN {
                dw.SetPosition(DWPOS_FILL).map_err(text)?;
            }
            dw.SetWallpaper(PCWSTR(id_wide.as_ptr()), PCWSTR(path_wide.as_ptr())).map_err(text)
        }
    }

    pub fn current() -> Result<SavedWallpapers, String> {
        let dw = desktop()?;
        let mut monitors = Vec::new();
        for id in ids(&dw)? {
            let id_wide = wide(&id);
            unsafe {
                if let Ok(path) = dw.GetWallpaper(PCWSTR(id_wide.as_ptr())) {
                    monitors.push(SavedWallpaper { id, path: path.to_string().unwrap_or_default() });
                    CoTaskMemFree(Some(path.0 as _));
                }
            }
        }
        let position = unsafe { dw.GetPosition().map_err(text)?.0 };
        Ok(SavedWallpapers { position, monitors })
    }

    pub fn restore(saved: SavedWallpapers) -> Result<(), String> {
        let dw = desktop()?;
        let connected = ids(&dw)?;
        let mut failed = 0;
        for SavedWallpaper { id, path } in saved.monitors {
            // Only screens connected now, and only pictures on this computer (an empty path means none).
            if !connected.contains(&id) || (!path.is_empty() && !is_local_image(&path)) {
                failed += 1;
                continue;
            }
            let (id_wide, path_wide) = (wide(&id), wide(&path));
            if unsafe { dw.SetWallpaper(PCWSTR(id_wide.as_ptr()), PCWSTR(path_wide.as_ptr())) }.is_err() {
                failed += 1;
            }
        }
        // 0 to 5: center, tile, stretch, fit, fill, span.
        if (0..=5).contains(&saved.position) {
            unsafe { dw.SetPosition(DESKTOP_WALLPAPER_POSITION(saved.position)).map_err(text)? };
        }
        if failed > 0 {
            Err(format!("{failed} screen(s) couldn't get their old background back."))
        } else {
            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod shell {
    use super::{Monitor, SavedWallpapers};
    const NOT_HERE: &str = "Per-screen backgrounds are only supported on Windows.";
    pub fn run<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        f()
    }
    pub fn monitors() -> Result<Vec<Monitor>, String> {
        Err(NOT_HERE.into())
    }
    pub fn set(_index: u32, _path: &str) -> Result<(), String> {
        Err(NOT_HERE.into())
    }
    pub fn current() -> Result<SavedWallpapers, String> {
        Err(NOT_HERE.into())
    }
    pub fn restore(_saved: SavedWallpapers) -> Result<(), String> {
        Err(NOT_HERE.into())
    }
}

#[tauri::command]
pub fn set_keep_running(state: tauri::State<'_, KeepRunning>, on: bool) {
    state.0.store(on, Ordering::SeqCst);
}

/// True when Windows started the app at sign-in (the autostart entry passes --autostart).
#[tauri::command]
pub fn launched_at_login() -> bool {
    std::env::args().any(|arg| arg == "--autostart")
}

/// Sends a "minute" event just after every minute boundary. Events reach the page even while the window
/// is hidden, unlike browser timers, which are throttled in hidden windows.
pub fn start_minute_ticks(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let wait = 60_000 - (now.as_millis() % 60_000) as u64 + 300;
        std::thread::sleep(Duration::from_millis(wait));
        let _ = app.emit("minute", ());
    });
}

#[cfg(windows)]
fn apply(path: &str, persist: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
    };
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    // The minute-by-minute pictures aren't written to the user's profile; only a restore is.
    let flags = SPIF_SENDCHANGE | if persist { SPIF_UPDATEINIFILE } else { 0 };
    let ok = unsafe { SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, wide.as_ptr() as *mut _, flags) };
    if ok == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn read_current() -> Result<String, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETDESKWALLPAPER};
    let mut buffer = vec![0u16; 1024];
    let ok = unsafe { SystemParametersInfoW(SPI_GETDESKWALLPAPER, buffer.len() as u32, buffer.as_mut_ptr() as *mut _, 0) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Ok(String::from_utf16_lossy(&buffer[..len]))
}

#[cfg(not(windows))]
fn apply(_path: &str, _persist: bool) -> Result<(), String> {
    Err("Setting the desktop background is only supported on Windows.".into())
}

#[cfg(not(windows))]
fn read_current() -> Result<String, String> {
    Err("Reading the desktop background is only supported on Windows.".into())
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

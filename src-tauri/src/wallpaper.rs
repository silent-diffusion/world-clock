//! "Set as background": the app draws a view as a picture once a minute and hands it to Windows as the
//! desktop wallpaper. Nothing runs between updates, which keeps it light on power.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// While the background is on, closing the window hides it instead of quitting, so updates continue.
pub struct KeepRunning(pub AtomicBool);

/// Windows caches the wallpaper by file name, so the picture alternates between two files.
static USE_SECOND_FILE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_wallpaper(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
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
pub fn current_wallpaper() -> Result<String, String> {
    read_current()
}

/// Puts back a wallpaper (the one from before "Set as background" was turned on) and saves it.
#[tauri::command]
pub fn restore_wallpaper(path: String) -> Result<(), String> {
    apply(&path, true)
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

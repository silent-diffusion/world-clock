use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

mod desktop_icons;
mod update;
mod wallpaper;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: opening World Clock again (e.g. from the Start menu) brings the
        // running window to the front instead of starting a second copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        // Remembers the window's size, position and maximized state between launches. Only those: the
        // default also restores the title bar setting, which brought back the Windows title bar for
        // anyone who had used a version that still had it.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(wallpaper::KeepRunning(AtomicBool::new(false)))
        .on_window_event(|window, event| {
            // While World Clock is the desktop background, closing the window only hides it.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<wallpaper::KeepRunning>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            update::install_update,
            wallpaper::set_wallpaper,
            wallpaper::current_wallpaper,
            wallpaper::restore_wallpaper,
            wallpaper::set_keep_running,
            wallpaper::launched_at_login,
            desktop_icons::desktop_icons
        ])
        .setup(|app| {
            update::clean_up(app.handle());
            wallpaper::start_minute_ticks(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running World Clock");
}

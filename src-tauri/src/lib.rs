use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_window_state::StateFlags;

mod desktop;
mod update;

/// Opens the settings window, or brings it to the front if it is already open.
fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("World Clock Settings")
        .inner_size(560.0, 760.0)
        .min_inner_size(440.0, 480.0)
        .center()
        .build();
}

/// Lets the widget open settings (it does so on right-click).
#[tauri::command]
fn open_settings_window(app: AppHandle) {
    open_settings(&app);
}

/// Shows the widget if it was hidden. It stays on the desktop layer, so it isn't focused or raised.
fn show_widget(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: launching the app again (e.g. from the Start menu) opens settings
        // in the copy that is already running instead of starting a second widget.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_settings(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        // Remembers where the widget sits (its size comes from Settings); the settings window always opens centred.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["settings"])
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_settings_window, update::install_update])
        .setup(|app| {
            update::clean_up(app.handle());
            if let Some(widget) = app.get_webview_window("main") {
                desktop::pin_to_desktop(&widget);
            }

            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let updates = MenuItem::with_id(app, "updates", "Check for updates", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit World Clock", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings, &updates, &separator, &quit])?;

            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("World Clock")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "settings" => open_settings(app),
                    "updates" => {
                        let _ = app.emit_to("main", "check-for-updates", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_widget(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running World Clock");
}

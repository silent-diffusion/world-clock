//! Makes the widget behave like part of the desktop instead of an app window.

/// Pins the widget to the desktop layer on Windows:
/// - owned by the desktop window (Progman), so "Show desktop" (Win+D) leaves it visible;
/// - a tool window, so it never appears in the taskbar or Alt+Tab;
/// - never activated by clicks, so it doesn't jump in front of other windows;
/// - placed at the bottom of the window stack, just above the wallpaper and icons.
#[cfg(windows)]
pub fn pin_to_desktop(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWLP_HWNDPARENT, GWL_EXSTYLE, HWND_BOTTOM,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = handle.0 as HWND;
    let class: Vec<u16> = "Progman\0".encode_utf16().collect();

    unsafe {
        let progman = FindWindowW(class.as_ptr(), std::ptr::null());
        if !progman.is_null() {
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, progman as isize);
        }

        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let ex_style = (ex_style | WS_EX_TOOLWINDOW as isize | WS_EX_NOACTIVATE as isize) & !(WS_EX_APPWINDOW as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style);

        SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
}

#[cfg(not(windows))]
pub fn pin_to_desktop(_window: &tauri::WebviewWindow) {}

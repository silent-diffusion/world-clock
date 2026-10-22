//! Where the desktop icons are, so the background layout editor can show them. Uses the shell's own
//! interface for the desktop's icon view (IShellWindows → IShellBrowser → IFolderView), the documented
//! way to ask Explorer for icon positions.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIcon {
    pub name: String,
    /// Top-left of the icon's cell, in physical pixels from the primary display's top-left corner.
    pub x: i32,
    pub y: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIcons {
    /// Primary display size in physical pixels.
    pub screen_width: i32,
    pub screen_height: i32,
    /// Size of one icon cell (icon plus label) in physical pixels.
    pub cell_width: i32,
    pub cell_height: i32,
    /// Only icons on the primary display.
    pub icons: Vec<DesktopIcon>,
}

#[tauri::command]
pub async fn desktop_icons() -> Result<DesktopIcons, String> {
    // COM needs its own single-threaded apartment, so run on a fresh thread.
    std::thread::spawn(read).join().map_err(|_| "Reading the desktop icons failed.".to_string())?
}

#[cfg(windows)]
fn read() -> Result<DesktopIcons, String> {
    use windows::core::{Interface, PWSTR};
    use windows::Win32::Foundation::{POINT, S_OK};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IServiceProvider, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::{VARIANT, VT_I4};
    use windows::Win32::UI::Shell::Common::{ITEMIDLIST, STRRET};
    use windows::Win32::UI::Shell::{
        IEnumIDList, IFolderView, IShellBrowser, IShellFolder, IShellWindows, ShellWindows, StrRetToStrW, CSIDL_DESKTOP,
        SHGDN_NORMAL, SID_STopLevelBrowser, SVGIO_ALLVIEW, SWC_DESKTOP, SWFO_NEEDDISPATCH,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };

    let text = |e: windows::core::Error| e.message();

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(text)?;
        let result = (|| -> Result<DesktopIcons, String> {
            let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL).map_err(text)?;

            let mut location = VARIANT::default();
            (*location.Anonymous.Anonymous).vt = VT_I4;
            (*location.Anonymous.Anonymous).Anonymous.lVal = CSIDL_DESKTOP as i32;
            let empty = VARIANT::default();
            let mut hwnd = 0i32;
            let dispatch = windows
                .FindWindowSW(&location, &empty, SWC_DESKTOP, &mut hwnd, SWFO_NEEDDISPATCH)
                .map_err(text)?;

            let browser: IShellBrowser = dispatch.cast::<IServiceProvider>().map_err(text)?.QueryService(&SID_STopLevelBrowser).map_err(text)?;
            let view: IFolderView = browser.QueryActiveShellView().map_err(text)?.cast().map_err(text)?;
            let folder: IShellFolder = view.GetFolder().map_err(text)?;

            let mut spacing = POINT::default();
            view.GetSpacing(&mut spacing).map_err(text)?;

            // Item positions are relative to the desktop's icon view, which spans the whole virtual screen.
            let origin_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let origin_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let screen_width = GetSystemMetrics(SM_CXSCREEN);
            let screen_height = GetSystemMetrics(SM_CYSCREEN);

            let items: IEnumIDList = view.Items(SVGIO_ALLVIEW).map_err(text)?;
            let mut icons = Vec::new();
            loop {
                let mut pidl: [*mut ITEMIDLIST; 1] = [std::ptr::null_mut()];
                let mut fetched = 0u32;
                if items.Next(&mut pidl, Some(&mut fetched)) != S_OK || fetched == 0 {
                    break;
                }
                let item = pidl[0];
                let position = view.GetItemPosition(item);
                let mut strret = STRRET::default();
                let mut name = String::new();
                if folder.GetDisplayNameOf(item, SHGDN_NORMAL, &mut strret).is_ok() {
                    let mut wide = PWSTR::null();
                    if StrRetToStrW(&mut strret, Some(item), &mut wide).is_ok() {
                        name = wide.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(wide.0 as _));
                    }
                }
                CoTaskMemFree(Some(item as _));
                if let Ok(p) = position {
                    let x = p.x + origin_x;
                    let y = p.y + origin_y;
                    if x >= 0 && y >= 0 && x < screen_width && y < screen_height {
                        icons.push(DesktopIcon { name, x, y });
                    }
                }
            }

            Ok(DesktopIcons { screen_width, screen_height, cell_width: spacing.x, cell_height: spacing.y, icons })
        })();
        CoUninitialize();
        result
    }
}

#[cfg(not(windows))]
fn read() -> Result<DesktopIcons, String> {
    Err("Desktop icons can only be read on Windows.".into())
}

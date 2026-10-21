//! One-click updates: download the newest installer from GitHub Releases into the app's data folder,
//! check it against the SHA-256 checksum GitHub publishes for it, run it in update mode, and exit.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const LATEST_RELEASE_API: &str = "https://api.github.com/repos/silent-diffusion/world-clock/releases/latest";
// The release workflow uploads the newest installer under this fixed name.
const INSTALLER_NAME: &str = "World-Clock-Setup.exe";

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    /// "sha256:<hex>", computed by GitHub when the file was uploaded.
    digest: Option<String>,
}

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(text)?.join("updates"))
}

/// Removes installers left over from a previous update.
pub fn clean_up(app: &AppHandle) {
    if let Ok(dir) = updates_dir(app) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("world-clock/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(text)?;

    let release: Release = client
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(text)?
        .error_for_status()
        .map_err(text)?
        .json()
        .await
        .map_err(text)?;

    let asset = release
        .assets
        .into_iter()
        .find(|a| a.name == INSTALLER_NAME)
        .ok_or("The latest release has no installer.")?;
    let expected = asset
        .digest
        .as_deref()
        .and_then(|d| d.strip_prefix("sha256:"))
        .ok_or("The latest release has no checksum.")?
        .to_ascii_lowercase();

    let bytes = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(text)?
        .error_for_status()
        .map_err(text)?
        .bytes()
        .await
        .map_err(text)?;

    let actual: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    if actual != expected {
        return Err("The download didn't match GitHub's checksum, so it wasn't installed.".into());
    }

    let version: String = release
        .tag_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.')
        .collect();
    let dir = updates_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(text)?;
    let installer = dir.join(format!("World-Clock-{version}-Setup.exe"));
    std::fs::write(&installer, &bytes).map_err(text)?;

    // /P: progress bar only, no questions. /UPDATE: in-place update. /R: start World Clock again afterwards.
    std::process::Command::new(&installer)
        .args(["/P", "/UPDATE", "/R"])
        .spawn()
        .map_err(text)?;

    // Quit so the installer can replace the running files.
    app.exit(0);
    Ok(())
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

//! One-click updates: download the newest installer from GitHub Releases into the app's data folder,
//! check it against the SHA-256 checksum GitHub publishes for it, run it in update mode, and exit.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

const LATEST_RELEASE_API: &str = "https://api.github.com/repos/silent-diffusion/world-clock/releases/latest";
// The release workflow uploads the newest installer under this fixed name.
const INSTALLER_NAME: &str = "World-Clock-Setup.exe";
const DOWNLOAD_PREFIX: &str = "https://github.com/silent-diffusion/world-clock/releases/download/";
const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
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
    // Two installs at once would write and run the same installer file.
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("An update is already being installed.".into());
    }
    let result = install(&app).await;
    if result.is_ok() {
        // Quit so the installer can replace the running files.
        app.exit(0);
    } else {
        INSTALLING.store(false, Ordering::SeqCst);
    }
    result
}

async fn install(app: &AppHandle) -> Result<(), String> {
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

    let version: String = release
        .tag_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.')
        .collect();
    // An unreadable version (None) sorts below every real one, so it's refused too.
    if parse_version(&version) <= parse_version(env!("CARGO_PKG_VERSION")) {
        return Err("The latest release isn't newer than this version.".into());
    }

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

    // Parsing first resolves any "../" so the prefix check can't be walked around.
    let url = reqwest::Url::parse(&asset.browser_download_url).map_err(text)?;
    if !url.as_str().starts_with(DOWNLOAD_PREFIX) {
        return Err("The installer isn't hosted on World Clock's releases page.".into());
    }
    let too_big = "The installer is larger than expected, so it wasn't downloaded.";
    if asset.size > MAX_DOWNLOAD_BYTES {
        return Err(too_big.into());
    }

    let mut response = client.get(url).send().await.map_err(text)?.error_for_status().map_err(text)?;
    if response.content_length().is_some_and(|len| len > MAX_DOWNLOAD_BYTES) {
        return Err(too_big.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(text)? {
        if (bytes.len() + chunk.len()) as u64 > MAX_DOWNLOAD_BYTES {
            return Err(too_big.into());
        }
        bytes.extend_from_slice(&chunk);
    }

    let actual: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    if actual != expected {
        return Err("The download didn't match GitHub's checksum, so it wasn't installed.".into());
    }

    let dir = updates_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(text)?;
    let installer = dir.join(format!("World-Clock-{version}-Setup.exe"));
    std::fs::write(&installer, &bytes).map_err(text)?;

    // /P: progress bar only, no questions. /UPDATE: in-place update. /R: start World Clock again afterwards.
    std::process::Command::new(&installer)
        .args(["/P", "/UPDATE", "/R"])
        .spawn()
        .map_err(text)?;
    Ok(())
}

/// "1.4.0" or "v1.4.0" as numbers, so 1.10.0 sorts after 1.9.0.
fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.strip_prefix('v').unwrap_or(version).split('.').map(|p| p.parse().ok());
    let parsed = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(parsed)
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

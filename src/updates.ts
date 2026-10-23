import { getVersion } from "@tauri-apps/api/app";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

const REPO = "silent-diffusion/world-clock";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
// Fallback when the in-app install fails. The release workflow uploads the newest installer under this fixed name.
const DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/World-Clock-Setup.exe`;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  current: string;
  /** The newer version on GitHub, or null when the installed one is the latest. */
  latest: string | null;
}

/** Asks GitHub for the latest release. Throws when GitHub can't be reached. */
export async function findUpdate(): Promise<UpdateInfo> {
  const current = await getVersion();
  const response = await fetch(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return { current, latest: null }; // no releases yet
  if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
  const release: { tag_name: string } = await response.json();
  const latest = release.tag_name.replace(/^v/, "");
  return { current, latest: compareVersions(latest, current) > 0 ? latest : null };
}

export function openDownload(): Promise<void> {
  return openUrl(DOWNLOAD_URL);
}

/**
 * Downloads the newest installer into the app's data folder, checks it against GitHub's checksum,
 * and runs it. The app quits and the installer starts the new version when it's done.
 */
export async function installUpdate(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("install_update");
}

/** Installs the update; if that fails, offers the installer download in the browser instead. */
export async function installOrOfferDownload(): Promise<void> {
  try {
    await installUpdate();
  } catch (error) {
    console.warn("Update install failed", error);
    const download = await ask(`The update couldn't be installed automatically.\n\n${error}\n\nDownload the installer from GitHub instead?`, {
      title: "World Clock",
      kind: "warning",
      okLabel: "Download",
      cancelLabel: "Cancel",
    });
    if (download) await openDownload();
  }
}

let checking = false;

/**
 * Scheduled check: offers to install an update if there is one, and stays quiet otherwise.
 * ("Check now" in Settings shows its result inline instead.)
 */
async function promptForUpdate(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const { current, latest } = await findUpdate();
    if (latest) {
      const install = await ask(`World Clock ${latest} is available. You have ${current}.`, {
        title: "Update available",
        kind: "info",
        okLabel: "Install and restart",
        cancelLabel: "Later",
      });
      if (install) await installOrOfferDownload();
    }
  } catch (error) {
    console.warn("Update check failed", error);
  } finally {
    checking = false;
  }
}

/** Checks shortly after launch and then once a day, while automatic checks are turned on. */
export function scheduleUpdateChecks(enabled: () => boolean): void {
  const run = () => {
    if (enabled()) promptForUpdate();
  };
  setTimeout(run, 5000);
  setInterval(run, DAY_MS);
}

/**
 * Compares dotted version numbers ("0.10.0" > "0.9.2"); returns a positive number when a is newer.
 * A pre-release ("1.5.0-rc.1") is older than the release with the same number.
 */
function compareVersions(a: string, b: string): number {
  const [coreA, ...suffixA] = a.split("-");
  const [coreB, ...suffixB] = b.split("-");
  const pa = coreA.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = coreB.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return Number(!suffixA.length) - Number(!suffixB.length);
}

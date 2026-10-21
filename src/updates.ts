import { getVersion } from "@tauri-apps/api/app";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

const REPO = "silent-diffusion/world-clock";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
// The release workflow uploads the newest installer under this fixed name.
const DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/World-Clock-Setup.exe`;
const DAY_MS = 24 * 60 * 60 * 1000;

let checking = false;

/** Asks GitHub for the latest release and, if it is newer, offers to download the installer. */
export async function checkForUpdates(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const response = await fetch(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return; // 404 until the first release exists
    const release: { tag_name: string } = await response.json();

    const latest = release.tag_name.replace(/^v/, "");
    const current = await getVersion();
    if (compareVersions(latest, current) <= 0) return;

    const download = await ask(`World Clock ${latest} is available. You have ${current}.\n\nDownload the new installer now?`, {
      title: "Update available",
      kind: "info",
      okLabel: "Download",
      cancelLabel: "Later",
    });
    if (download) await openUrl(DOWNLOAD_URL);
  } catch (error) {
    // Offline or GitHub unreachable: try again at the next scheduled check.
    console.warn("Update check failed", error);
  } finally {
    checking = false;
  }
}

/** Checks shortly after launch and then once a day. */
export function scheduleUpdateChecks(): void {
  setTimeout(checkForUpdates, 5000);
  setInterval(checkForUpdates, DAY_MS);
}

/** Compares dotted version numbers ("0.10.0" > "0.9.2"); returns a positive number when a is newer. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

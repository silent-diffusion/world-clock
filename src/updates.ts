import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

const DAY_MS = 24 * 60 * 60 * 1000;

let checking = false;

/**
 * Looks for a newer release on GitHub (via the signed latest.json the release workflow publishes),
 * asks before installing, then restarts into the new version.
 */
export async function checkForUpdates(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const update = await check();
    if (!update) return;

    const notes = update.body?.trim() ? `\n\n${update.body.trim()}` : "";
    const install = await ask(`World Clock ${update.version} is available. You have ${update.currentVersion}.${notes}`, {
      title: "Update available",
      kind: "info",
      okLabel: "Install and restart",
      cancelLabel: "Later",
    });
    if (!install) return;

    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    // No network, GitHub unreachable, or no release yet: try again at the next scheduled check.
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

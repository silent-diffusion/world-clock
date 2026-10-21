# World Clock

A free, open-source desktop world clock widget. It shows a world map with a live
day/night shading line and the local time in the cities you care about, at a glance.

## Download

**[Download World Clock for Windows](https://github.com/silent-diffusion/world-clock/releases/latest/download/World-Clock-Setup.exe)**
(Windows 10/11, 64-bit)

Run the installer; no administrator rights are needed. Every release is listed on the
[Releases page](https://github.com/silent-diffusion/world-clock/releases).

> **Windows SmartScreen:** the installer is not code-signed with a paid certificate yet,
> so Windows may show "Windows protected your PC". Click **More info → Run anyway**.

After installing, World Clock runs in the background with an icon in the system tray
(the area by the clock on the taskbar):

- **Left-click** the tray icon to bring the widget to the front.
- **Right-click** the tray icon for **Settings…**, **Check for updates** and **Quit**.
- **Right-click the widget** to open Settings. Drag the widget to move it.

## Features

- **World map widget** with a live day/night terminator (the curved shadow that
  shows where the sun is up), updated every minute.
- **City pins** with a short label (for example `NYC`, `BRN`, `DXB`) and the local
  time in a compact `11:24 A` / `5:24 P` style.
- **Daylight-saving aware**: times come from the IANA time zone database, so DST
  changes are handled automatically.
- **Part of the desktop**: the widget sits on the desktop layer behind your windows, stays
  visible on "Show desktop" (Win+D), and never shows in the taskbar or Alt+Tab. Choose
  Small, Medium or Large in Settings; drag it to move it and it remembers where you put it.
- **Always running**: lives in the system tray and starts when you sign in to Windows
  (you can turn that off in Settings).
- **Edit your cities**: search about 7,000 cities, add or remove them, change the short
  label and which side of the pin it sits on.
- **Light and dark looks** that follow the system theme.
- **Updates from GitHub**: the app checks this repository's GitHub Releases for a
  newer version and installs it with one click. Automatic checks can be turned off in
  Settings, and you can always check by hand.

### Ideas for later

- 12-hour / 24-hour toggle and seconds display
- Meeting planner: line up working hours across the cities you track
- Sunrise and sunset times per city
- Alternative map styles and widget sizes
- macOS and Linux builds

## How updates work

Shortly after it starts, and then once a day, the app asks the GitHub API for this
repository's latest release. If that release is newer than the installed version, it
shows "Update available" with an **Install and restart** button. One click downloads
the new installer into the app's data folder, checks it against the SHA-256 checksum
GitHub publishes for it, installs it in place and restarts World Clock. Nothing is
downloaded or installed without you clicking. If the automatic install fails, the app
offers to open the installer download in your browser instead.

## Tech stack

| Part | Choice | Why |
| --- | --- | --- |
| App shell | [Tauri 2](https://tauri.app) | Small installer, low memory use, native transparent/frameless windows |
| UI | TypeScript + HTML/CSS (SVG map) | Easy to style the widget and draw the day/night curve |
| Time zones | `Intl` / IANA tz data | Accurate DST handling without a server |
| Updates | GitHub Releases API | Finds new versions with no keys or extra servers |
| Builds | GitHub Actions | Builds and publishes a release when a version tag is pushed |

The first target is **Windows 10/11**. Tauri also supports macOS and Linux, so those
can follow.

## Getting started (for contributors)

You will need:

- [Node.js](https://nodejs.org) (LTS)
- [Rust](https://www.rust-lang.org/tools/install)
- The [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS
  (on Windows: Microsoft C++ Build Tools and WebView2)

```bash
npm install
npm run tauri dev     # run the desktop app with hot reload
npm run dev           # or preview just the widget in a browser at http://localhost:1420
npm run tauri build   # build the Windows installer
```

Project layout:

| Path | What it is |
| --- | --- |
| `src/main.ts` | Draws the widget and redraws it every minute |
| `src/sun.ts` | Sun position and the day/night line |
| `src/map.ts` | Coastlines from Natural Earth |
| `src/cities.ts` | The default list of cities |
| `src/settings.ts` | Saved settings shared by both windows |
| `src/settings-page.ts` | The Settings window (`settings.html`) |
| `src/updates.ts` | Checks GitHub for a newer release |
| `src-tauri/src/update.rs` | Downloads, verifies and runs the update installer |
| `src-tauri/src/desktop.rs` | Pins the widget to the desktop layer |
| `src-tauri/` | The Rust/Tauri desktop shell and window settings |

## Releasing (maintainers)

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. The [Release workflow](.github/workflows/release.yml) builds the installer on GitHub
   and publishes the release. Installed copies offer it on their next update check.

No secrets or signing keys are needed.

## Contributing

Issues and pull requests are welcome. If you have an idea for a feature, open an
issue first so it can be discussed.

## License

To be decided before the first release (MIT is the current plan).

## Credits

Map shapes come from public-domain [Natural Earth](https://www.naturalearthdata.com)
data. The city search uses the [city-timezones](https://github.com/kevinroberts/city-timezones)
list (MIT), which is also based on Natural Earth.

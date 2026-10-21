# World Clock

A free, open-source world clock app for Windows. It shows a world map with a live
day/night shading line and the local time in the cities you care about, at a glance.

## Download

**[Download World Clock for Windows](https://github.com/silent-diffusion/world-clock/releases/latest/download/World-Clock-Setup.exe)**
(Windows 10/11, 64-bit)

Run the installer; no administrator rights are needed. Every release is listed on the
[Releases page](https://github.com/silent-diffusion/world-clock/releases).

> **Windows SmartScreen:** the installer is not code-signed with a paid certificate yet,
> so Windows may show "Windows protected your PC". Click **More info → Run anyway**.

World Clock opens as a clean window with no title bar. Move the mouse to the **top
edge** to reveal a bar with the view tabs, mini mode, Settings and the minimize, maximize
and close buttons. Drag that bar to move the window and drag the edges to resize.

## Views

Swipe sideways (trackpad, mouse drag or touch), use the tabs, or press **←** / **→** to
move between views. Choose which views you want, and their order, in Settings.

- **Map**: a dark, dotted world map with a live day/night shadow, a glow where the sun is
  overhead, and each city's time on a label right beside its pin.
- **Day**: one row per city with a 24-hour bar of daylight and night, your working hours
  outlined, and midnights marked with the day name.
- **Sky**: a card per city, coloured by its real sky right now: morning, afternoon,
  evening, twilight or night.
- **Dial**: every city placed around one 24-hour clock face, with your time in the middle.
- **Meet**: pick the cities in a meeting and see, hour by hour on your own day, when
  everyone is working. Copy the shared slot's times to paste into an invite.

## Features

- **See any moment**: click a city (on any view), then scroll or press **↑** / **↓**
  (**Page Up** / **Page Down** for an hour) to move time in 15-minute steps. Every view
  follows, times turn amber, a badge shows how far you've moved ("+4 hr", "−2 hr 30 min"),
  and cities whose date changes show "+1d" or "−1d". Press **Esc**, click the city again or
  click empty space to return to now.
- **Map extras**, each a switch in Settings:
  - **City details**: click a city for sunrise, sunset, golden hour, day length, its next
    clock change and your own note.
  - **Clock-change warnings**: a heads-up a week before any of your cities changes its
    clocks, with the date on that city's label.
  - **Dim cities where people are asleep** (11 PM to 7 AM local time).
  - **Times relative to the selected city**: labels show "+6h" instead of the time.
  - **Where it's already tomorrow**: shades the part of the world past midnight.
- **Mini mode**: shrink to a slim strip of times that stays on top of other windows,
  showing every city or only the ones you've pinned.
- **Daylight-saving aware**: times come from the IANA time zone database, so clock changes
  are handled automatically.
- **Edit your cities**: search about 7,000 cities, add or remove them, sort them, change
  the short label and which side of the pin it sits on, pin them for mini mode, and add a note.
- **Starts when you sign in** to Windows (you can turn that off in Settings), and opening it
  again brings the existing window to the front.
- **Updates from GitHub**: the app checks this repository's releases and installs a newer
  version with one click.

### Ideas for later

- 12-hour / 24-hour toggle and seconds display
- A light theme
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
| UI | TypeScript + HTML/CSS (SVG map) | Easy to style the app and draw the day/night curve |
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
npm run dev           # or preview the app in a browser at http://localhost:1420
npm run tauri build   # build the Windows installer
```

Project layout:

| Path | What it is |
| --- | --- |
| `index.html` | The app window: views, mini strip and Settings |
| `src/main.ts` | The shell: tabs, swiping, keyboard, scrubbing time, mini mode, the top bar |
| `src/views/` | One file per view (map, day, sky, dial, meet, mini) plus shared city data |
| `src/state.ts` | The selected city and time shift, shared by every view |
| `src/time.ts` | Time-zone helpers, including finding the next clock change |
| `src/sun.ts` | Sun position, the day/night line, sunrise and sunset |
| `src/map.ts` | Coastlines from Natural Earth |
| `src/cities.ts` | The default list of cities |
| `src/settings.ts` | Saved settings |
| `src/settings-page.ts` | The Settings page |
| `src/updates.ts` | Checks GitHub for a newer release |
| `src-tauri/src/update.rs` | Downloads, verifies and runs the update installer |
| `src-tauri/` | The Rust/Tauri desktop shell and window settings |

## Releasing (maintainers)

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Commit, then tag and push: `git tag v1.1.0 && git push origin main v1.1.0`.
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

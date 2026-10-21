# World Clock

A free, open-source desktop world clock widget. It shows a world map with a live
day/night shading line and the local time in the cities you care about, at a glance.

> **Status:** early design. Nothing is built yet; this README describes what the app
> is meant to become.

## Features

### Planned for the first release

- **World map widget** with a live day/night terminator (the curved shadow that
  shows where the sun is up), updated every minute.
- **City pins** with a short label (for example `NYC`, `BRN`, `DXB`) and the local
  time in a compact `11:24 A` / `5:24 P` style.
- **Daylight-saving aware**: times come from the IANA time zone database, so DST
  changes are handled automatically.
- **Desktop widget behaviour**: a frameless, rounded window that can sit on the
  desktop or stay on top, remembers its size and position, and can start with the
  computer.
- **Edit your cities**: search for a city, set its short label, reorder or remove it.
- **Light and dark looks** that follow the system theme.
- **Updates from GitHub**: the app checks this repository's GitHub Releases for a
  newer version, tells you when one is available, and can download and install it
  for you. You can also check manually from the settings.

### Ideas for later

- 12-hour / 24-hour toggle and seconds display
- Meeting planner: line up working hours across the cities you track
- Sunrise and sunset times per city
- Alternative map styles and widget sizes
- macOS and Linux builds

## How updates work

Releases are published on this repository's
[Releases page](../../releases). Each release includes the installer and a small
update manifest. The app reads that manifest, compares versions, and offers to
update. Update packages are signed, and the app checks the signature before
installing, so only builds published from this project can be installed this way.

Updates are never installed silently without a setting that allows it. By default
the app checks on launch and once a day, and asks before installing.

## Tech stack (proposed)

| Part | Choice | Why |
| --- | --- | --- |
| App shell | [Tauri 2](https://tauri.app) | Small installer, low memory use, native transparent/frameless windows |
| UI | TypeScript + HTML/CSS (SVG map) | Easy to style the widget and draw the day/night curve |
| Time zones | `Intl` / IANA tz data | Accurate DST handling without a server |
| Updates | Tauri updater plugin + GitHub Releases | Signed updates straight from this repo |
| Builds | GitHub Actions | Builds and publishes a release when a version tag is pushed |

The first target is **Windows 10/11**. Tauri also supports macOS and Linux, so those
can follow.

## Getting started (for contributors)

Setup instructions will be added once the project is scaffolded. You will need:

- [Node.js](https://nodejs.org) (LTS)
- [Rust](https://www.rust-lang.org/tools/install)
- The [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS

## Contributing

Issues and pull requests are welcome. If you have an idea for a feature, open an
issue first so it can be discussed.

## License

To be decided before the first release (MIT is the current plan).

## Credits

Map shapes will come from public-domain [Natural Earth](https://www.naturalearthdata.com)
data.

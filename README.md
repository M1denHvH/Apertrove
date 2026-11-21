<p align="center">
  <img src="assets/icon.png" width="88" height="88" alt="Apertrove">
</p>
<h1 align="center">Apertrove</h1>
<p align="center"><strong>A place for your camera, your shoot, and the next frame.</strong></p>
<p align="center">Canon EOS camera controls, Live View and a photo workspace for Windows.</p>

<p align="center">
  <a href="https://github.com/M1denHvH/Apertrove/actions/workflows/ci.yml"><img src="https://github.com/M1denHvH/Apertrove/actions/workflows/ci.yml/badge.svg?branch=main" alt="Main branch Windows checks"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/source-0.10.3-blue" alt="Source version 0.10.3"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/M1denHvH/Apertrove" alt="MIT license"></a>
  <a href="https://github.com/M1denHvH/Apertrove/releases/latest"><img src="https://img.shields.io/github/v/release/M1denHvH/Apertrove" alt="Latest published release"></a>
</p>

<p align="center">
  <a href="https://github.com/M1denHvH/Apertrove/releases">Download</a> ·
  <a href="docs/INSTALLATION.md">Get started</a> ·
  <a href="docs/USER_GUIDE.md">User guide</a> ·
  <a href="docs/COMPATIBILITY.md">Camera compatibility</a> ·
  <a href="README.ru.md">Русский</a>
</p>

![Apertrove Capture workspace with a simulated camera preview](docs/screenshots/workspace.png)

Apertrove brings camera settings, framing, photo review and session folders into one desktop application. Connect a compatible Canon camera by USB to compose on a larger screen, or work with existing photos without connecting a camera.

It is an independent open-source project. It uses your separately installed Canon runtime and includes no Canon SDK binaries.

## Made for a shoot

| Work with your camera | Keep the shoot together |
| --- | --- |
| Live View with composition guides, zoom and a compact RGB histogram toggle | Named sessions with their own folders, notes and presets |
| Camera-reported exposure, white balance, image quality and focus controls | Local import, ratings, filters and metadata inspection |
| One-shot AF, sustained AI Servo commands and electronic lens steps where supported | Nondestructive adjustments and separate JPEG/metadata exports |
| Camera presets, ordered preset series and interval tools | A separate Shot Inspector window for registered camera arrivals |
| A phone browser remote on a trusted LAN | Lighting Studio palettes and diagrams |

Availability follows the camera, lens, shooting mode and installed runtime. AI Servo command acceptance does not confirm optical focus. Dedicated BULB and mechanical flash pop-up remain unavailable until their protocols are qualified. Capture and camera-file transfers still need broader physical validation. [Read compatibility notes](docs/COMPATIBILITY.md).

## A closer look

All images below are direct screenshots of the running application. They use an isolated demo profile, sample artwork and a fake provider; they are **simulated previews**, not evidence of a connected physical camera.

<details open>
<summary><strong>Sessions — one folder and context for each shoot</strong></summary>

![Session folders and notes](docs/screenshots/sessions.png)

</details>

<details>
<summary><strong>Library — review, rate and organize your frames</strong></summary>

![Photo library with demonstration images](docs/screenshots/library.png)

</details>

<details>
<summary><strong>Shot Inspector — a dedicated review window</strong></summary>

![Shot Inspector showing a demonstration frame](docs/screenshots/inspector.png)

</details>

<details>
<summary><strong>Lighting Studio — choose colors and plan a setup</strong></summary>

![Lighting Studio palette](docs/screenshots/lighting.png)

</details>

<details>
<summary><strong>Your workspace — language, theme and appearance</strong></summary>

![Apertrove appearance and settings](docs/screenshots/settings.png)

</details>

## Get started

1. Download the Windows x64 ZIP and checksum file from [Releases](https://github.com/M1denHvH/Apertrove/releases). Verify the SHA-256 and extract the entire archive.
2. Open **Apertrove.exe** and keep the rest of the application folder alongside it. The portable build is unsigned.
3. For camera work, install compatible official **Canon EDSDK x64** components separately. Use the setup guide to find the runtime and check your camera.
4. Create a session, choose its folder, and open **Capture → Start Live View**. Or skip camera setup and import existing photos into the Library.

The published release is a snapshot. This branch contains further development changes, and the source version remains **0.10.3** until a release is prepared.

[Full installation guide](docs/INSTALLATION.md) · [System requirements](docs/REQUIREMENTS.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

## Requirements

- Windows x64; Node.js 24 and npm if building from source.
- A USB data cable and compatible Canon runtime for camera controls.
- A compatible camera, lens and shooting mode. Controls are enabled from reported capabilities rather than a universal model promise.
- A trusted local network for Web Remote. The camera stays connected to the computer by USB.

Library, photo organization and Lighting Studio work without Canon software. Keep independent originals when testing camera-transfer workflows.

## Develop

```powershell
git clone https://github.com/M1denHvH/Apertrove.git
cd Apertrove
npm ci
npm run build
npm start
```

React and Vite render the workspace; Electron owns desktop services; the camera worker talks to EDSDK through Koffi. Fake-provider tests exercise controls without a camera.

[Development and checks](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Localization](docs/localization.md)

## Help and contributions

Found a problem? Open a [bug report](https://github.com/M1denHvH/Apertrove/issues/new?template=bug_report.yml) with your app version and reproduction steps. Include the camera/runtime combination only when relevant. Remove access keys, private paths, serial numbers and personal images.

For an idea, use a [feature request](https://github.com/M1denHvH/Apertrove/issues/new?template=feature_request.yml). Camera support reports are welcome; a successful command is different from confirmed physical behavior.

Apertrove source is [MIT licensed](LICENSE). Canon components and third-party dependencies have their own terms. Apertrove is not affiliated with or endorsed by Canon.

[Third-party notices](THIRD_PARTY_NOTICES.md) · [Privacy](docs/PRIVACY.md) · [Security reporting](SECURITY.md)

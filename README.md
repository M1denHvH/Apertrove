<p align="center"><img src="assets/icon.png" width="88" height="88" alt="Apertrove logo"></p>
<h1 align="center">Apertrove</h1>
<p align="center">Canon EOS USB controls, photo sessions and a local library for Windows.</p>

[Русский](README.ru.md) · [Install](docs/INSTALLATION.md) · [User guide](docs/USER_GUIDE.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

Apertrove is an independent, open-source workspace for Canon EOS cameras. Frame on a larger screen with Live View, adjust the settings available in your shooting mode, and keep your photos organized by session. The local library and Lighting Studio also work without a camera.

![Capture workspace with a synthetic demo camera and sample preview](docs/screenshots/workspace.png)

| Organize the shoot | Plan the light |
| --- | --- |
| ![Sessions with demonstration data](docs/screenshots/sessions.png) | ![A color harmony in Lighting Studio](docs/screenshots/lighting.png) |

These are screenshots of the current production build running in Electron with an isolated demonstration profile. The workspace uses a fake camera provider and a synthetic preview. Sample images and camera readings are demonstration data.

## What you can do

- **Preview and adjust.** Use Live View, composition guides, preview zoom, the software RGB histogram, and the exposure and focus commands supported by your camera.
- **Repeat settings.** Save presets, arrange an ordered preset series, or use interval shooting. Capture features require a supported working camera connection; their hardware status is listed below.
- **Organize and review.** Create session folders, import existing photos, rate and filter frames, inspect metadata, and save nondestructive adjustments. Export edited supported images as JPEG or metadata as JSON.
- **Review camera arrivals.** Shot Inspector follows registered camera transfers in a separate window, with pinning, Fit / 100% views, metadata and an image histogram.
- **Plan lighting.** Compare color harmonies, save palettes, and explore lighting diagrams in Lighting Studio.
- **Use a phone remote.** Open Web Remote in a browser on the same trusted LAN. The camera remains connected to the computer by USB.
- **Set up your workspace.** Choose English or Russian, light / dark / system themes, Studio / Canon Classic / Modern styling, an accent color and panel layout.

[Full user guide](docs/USER_GUIDE.md) · [Russian guide](docs/STUDIO.ru.md) · [System requirements](docs/REQUIREMENTS.md)

## Install and get started

1. Download `Apertrove-0.10.3-Windows-x64.zip` and `SHA256SUMS.txt` from the [published release](https://github.com/M1denHvH/Apertrove/releases/tag/Release). Compare the checksum, extract the whole ZIP, and open `Apertrove.exe`. The portable build is unsigned.
2. For camera controls, install official Canon software that supplies a compatible **x64 EDSDK**, or obtain the SDK through Canon. Runtime availability in EOS Utility and Picture Style Editor depends on their version and architecture. Setup searches common locations and lets you select the folder containing `EDSDK.dll`. Canon DLLs and proprietary headers are not included in Apertrove.
3. Close software using the camera, turn it on, and connect a USB data cable. Use **Find cameras** and **Check capabilities** in setup for read-only diagnostics. You can skip camera setup to work with local photos.
4. Create a session with a writable output folder. Open **Capture** for camera controls or **Library** to import existing files. Reopen setup or the interactive tutorial from **Settings**.

The published download is a snapshot; build from `main` for the current source version. See [installation and checksum instructions](docs/INSTALLATION.md), [requirements](docs/REQUIREMENTS.md) and [troubleshooting](docs/TROUBLESHOOTING.md).

## Camera support and current limits

Controlled hardware observations cover one **Canon EOS 2000D**, firmware **1.3.0**, with a **Sigma 17–70mm F2.8–4 DC MACRO OS HSM Contemporary C013** and **Picture Style Editor x64 EDSDK 3.18.40.0**. They recorded camera reads, ISO / shutter / aperture changes and restoration, **1056×704 Live View at about 27.5 FPS**, and software histogram ON/OFF.

AF on/off and near/far commands were accepted by the SDK. Focus acquisition and physical lens movement remain unverified. Real shutter release, capture, preset/interval shooting and camera file transfer have not passed hardware qualification; **H3 has not run**. **DATA-005** remains open: the existing transfer path acknowledges completion to Canon before local writing and library registration. Keep independent originals; local file import is available for existing photos.

**SEC-004**, the main window's Content Security Policy, remains open. Other bodies, lenses and runtime releases need separate compatibility checks. The controls-only route used during validation is distinct from the ordinary working connection; the regular UI has no controls-only selector.

[Camera compatibility and evidence](docs/HARDWARE_COMPATIBILITY.md) · [Feature status](docs/REQUIREMENTS.md#camera-support) · [Security](SECURITY.md)

## Develop

On Windows x64, install Git, Node.js 24 and npm, clone this repository, then run:

```powershell
npm ci
npm run build
npm start
```

For renderer development, run `npm run dev` in one terminal. In a second PowerShell terminal, set `$env:FOCAL_DEV_URL = 'http://127.0.0.1:5173'` and run `npm start`. Use the address printed by Vite if its port differs. `npm run package` creates the Windows directory bundle in `release/win-unpacked`.

The regular checks do not need Canon EDSDK:

```powershell
npm test
npm run test:t1
npm run i18n:check
npm run build
npm run preflight
```

Electron handles the desktop and IPC, React and Vite provide the renderer, and a separate camera worker loads the user's runtime through Koffi. [Contributing](CONTRIBUTING.md)

Source code is under the [MIT license](LICENSE). Canon EDSDK is obtained separately under Canon's terms; dependencies retain their own licenses. [Third-party notices](THIRD_PARTY_NOTICES.md) · [Privacy](docs/PRIVACY.md)

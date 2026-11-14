<p align="center"><img src="assets/icon.png" width="88" height="88" alt="Apertrove logo"></p>
<h1 align="center">Apertrove</h1>
<p align="center"><strong>Your Camera. Your Vision.</strong></p>
<p align="center">A Windows workspace for shooting tethered with Canon EOS.</p>

[Русский](README.ru.md) · [Install](docs/INSTALLATION.md) · [User guide](docs/USER_GUIDE.md) · [Release notes](docs/RELEASE_NOTES.md)

Apertrove brings the camera controls, the shoot folder, and the pictures you’ve already taken into one place. It’s for photographers who want to frame a shot on a bigger screen, review it as soon as it arrives, and keep the session organized as they work.

![Apertrove camera workspace with demonstration data](docs/screenshots/workspace.png)

| Organize the shoot | Set the light |
| --- | --- |
| ![Photo sessions](docs/screenshots/sessions.png) | ![Lighting Studio color harmonies](docs/screenshots/lighting.png) |

Screenshots are from the packaged app with an isolated demo profile, sample artwork, and no camera connected.

## What you can do

- **Frame and shoot from the computer.** Use Live View, composition guides, remote shutter release, and the exposure and focus controls available on your camera.
- **Repeat a setup.** Save camera presets or queue them in an ordered series to shoot variants of the same setup.
- **Keep each shoot together.** Give every session its own output folder. Import photos, browse the library, rate and filter frames, and inspect metadata.
- **Check a shot on another screen.** Shot Inspector follows new camera transfers. Pin a frame, zoom to 100%, or open the EXIF and RGB histogram alongside it.
- **Plan your lighting.** Find color harmonies, save palettes, and explore studio lighting diagrams in Lighting Studio.
- **Step away from the desk.** Open Web Remote on a phone on the same trusted local network and use the supported camera controls.
- **Make the workspace yours.** Choose a light, dark or system theme, Studio / Canon Classic / Modern styling, a custom accent, and Russian or English.

## Install and get started

1. From this repository’s **Releases** tab, download the Windows x64 ZIP attached to version **0.10.3**. Compare its SHA-256 with the accompanying checksum, then extract the entire ZIP.
2. Open `Apertrove.exe` inside the extracted folder. It’s an unsigned portable build, so Windows may show a reputation prompt. The full folder is needed at runtime.
3. You can create sessions, import photos, and use Lighting Studio straight away. For camera control, install official [EOS Utility](https://www.usa.canon.com/support/eos-utilities) for your model or obtain compatible x64 components through [Canon’s developer program](https://www.usa.canon.com/support/sdk). The first-run guide checks for them and lets you choose their folder.
4. Close EOS Utility, connect the powered camera with a USB data cable, and use Apertrove’s **Find cameras** action. Create a session and choose where incoming photos should go.

The **Canon EOS 2000D over USB** is the model with recorded hands-on Apertrove tests. Other cameras may work with a compatible x64 EDSDK, and the controls you see depend on the camera, lens, and shooting mode. The package was verified on Windows 10 x64. Windows 11 x64 is a target, pending a separate clean-machine check. See [requirements](docs/REQUIREMENTS.md) and [troubleshooting](docs/TROUBLESHOOTING.md).

## Develop

Open the **Code** menu on the repository page, copy its URL and run `git clone <repository-url>`. On Windows x64 with Node.js 24 and npm:

```powershell
npm ci
npm test
npm run i18n:check
npm run build
npm start
```

For live renderer development, run `npm run dev` in one terminal. In a second PowerShell terminal set `$env:FOCAL_DEV_URL = 'http://127.0.0.1:5173'` and run `npm start`. Set the URL to the address printed by Vite if its port differs. Use `npm run package` for the Windows directory bundle in `release/win-unpacked`. Tests, the build, and mock UI checks run without a Canon SDK installation. [Contributing](CONTRIBUTING.md)

Electron runs the desktop and IPC layer, React and Vite provide the UI, and the camera worker loads the local SDK through Koffi. Current areas for further work include broader camera testing, RAW preview coverage, and evaluating camera-specific Bulb and video control. [EDSDK coverage](docs/EDSDK_AUDIT.ru.md)

The project source carries the [MIT license](LICENSE). Electron, React, Koffi, Sharp, Lucide, Manrope, GSAP and the other libraries retain their own terms. Canon EDSDK is a separately obtained proprietary component. Apertrove is an independent project. [Third-party notices](THIRD_PARTY_NOTICES.md) · [Privacy](docs/PRIVACY.md) · [Security](SECURITY.md)

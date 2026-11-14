# Third-party notices

Apertrove code and original icon are MIT licensed. Dependencies retain their licenses; package-lock.json records exact versions.

| Component | License |
| --- | --- |
| Electron 45.3.2 | MIT. Chromium and bundled components have additional notices in `LICENSES.chromium.html`. |
| React, React DOM, Vite, electron-builder | MIT |
| Playwright | Apache-2.0 |
| Koffi | MIT |
| Sharp 0.35.5 | Apache-2.0. The Windows prebuilt package also contains libvips 8.18.7 and other libraries under LGPL and additional licenses. |
| exifr, chokidar, ws, qrcode | MIT |
| lucide-react icons | ISC |
| Manrope font | SIL Open Font License 1.1 |
| GSAP | [GSAP Standard “No Charge” License](https://gsap.com/standard-license/) |

Preserve the Electron and Chromium license files at the root of the portable folder, the npm license files in the application, and the additional `ThirdParty` directory in the ZIP. The GSAP license notice remains in the renderer bundle. A source export omits npm package contents. `npm ci` retrieves them with their notices.

### Sharp and libvips

The Windows x64 package ships Sharp’s prebuilt libvips shared libraries. Keep their notices and corresponding source references with any binary release. The original `@img/sharp-win32-x64@0.35.5` inventory lists the embedded libraries and their licenses.

- [Sharp v0.35.5 source](https://github.com/lovell/sharp/tree/v0.35.5) and [Windows x64 npm package](https://www.npmjs.com/package/@img/sharp-win32-x64/v/0.35.5).
- [Sharp’s libvips packaging v1.3.4](https://github.com/lovell/sharp-libvips/tree/v1.3.4) and [Windows build recipes for libvips 8.18.7](https://github.com/libvips/build-win64-mxe/tree/v8.18.7). The recipes specify dependency sources and patches.
- [libvips 8.18.7 sources](https://github.com/libvips/libvips/releases/tag/v8.18.7).

Canon EDSDK is proprietary and is not bundled, copied, relicensed or included. Users obtain compatible official SDK/software independently under Canon's terms. No Canon headers, manuals or vendor logos are part of this open source distribution. Reference: [Canon developer programme](https://developers.canon-europe.com/).

Equipment product photos loaded from official Canon/Sigma pages when equipment cards are opened remain the property of their respective rights holders. The project assets include the Apertrove logo, device schematics, photographic symbols, LCD artwork and demo screenshots. The screenshots use original geometric sample artwork.

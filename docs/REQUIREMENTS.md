# System and camera requirements

| Component | Requirement |
| --- | --- |
| Operating system | Windows x64. The published portable build was tested on Windows 10 x64, build 19045. A clean installation of Windows 11 x64 is still pending verification. |
| Architecture | The Windows package is x64. There are no x86 or ARM64 packages. |
| Storage | Allow space for the ZIP, the extracted application, the local profile and previews, and your session originals. |
| Camera connection | USB data cable and compatible 64-bit Canon EDSDK installed separately. Camera availability also depends on the body, firmware, lens, and shooting mode. |
| Web Remote | A browser on a trusted LAN that can reach the PC’s selected network interface. Apertrove uses HTTP and WebSocket for the remote. |
| Source builds | Windows x64, Git, npm and Node.js 24 as used by CI. Building and using the library without a camera do not require Canon EDSDK. |

## Camera support

Recorded hardware observations cover one **Canon EOS 2000D** over USB with firmware **1.3.0**, a **Sigma 17–70mm F2.8–4 DC MACRO OS HSM Contemporary C013**, and **Picture Style Editor x64 EDSDK 3.18.40.0**. The runtime and camera combination determines the controls available on your system. See the [complete compatibility evidence](HARDWARE_COMPATIBILITY.md) for the exact runtime fingerprint and test results.

| Feature | Observed status |
| --- | --- |
| Connect and inspect | Camera enumeration, opening a read-only session, reading camera settings and reporting supported choices were observed. The aggregate H1 report remains **UNKNOWN** for its module-location finding. |
| Exposure | Changes to ISO, shutter speed and aperture were verified and restored in the controls-only session. Other settings and modes depend on the reported camera capabilities. |
| Live View | 1056×704 preview at about 27.5 FPS and switching the software RGB histogram on and off were recorded in that setup. |
| Focus | The SDK accepted AF on/off and near/far lens commands. Optical focus acquisition and physical lens movement remain unverified. |
| Shutter, capture and camera file transfer | Implemented on supported connections but not yet qualified on hardware. H3 has not run. DATA-005 remains open: Apertrove sends Canon's download-complete acknowledgement before local writing and library registration. |
| Electron security | The main window’s Content Security Policy remains an open item (SEC-004). Use Web Remote on a trusted private LAN. [Security](../SECURITY.md) |

Other bodies, lenses and runtime versions need their own compatibility checks. Canon’s compatibility tables describe the SDK. Apertrove’s **Camera diagnostics** shows what your setup reports. Direct Wi-Fi camera control, video recording and software-controlled Bulb timing are outside the current feature set. [Canon SDK](https://www.usa.canon.com/support/sdk) · [Canon SDK compatibility and release notes](https://asia.canon/en/campaign/developerresources/camera/cap/edsdk-eos-digital-camera-sdk-release-note)

# System and camera requirements

| Component | Requirement |
| --- | --- |
| Operating system | Windows 10 x64 was tested on build 19045. Windows 11 x64 is a target pending a clean-machine test. Use a Windows installation that still receives your organization’s security updates. |
| Architecture | Native x64 Windows package. There are no x86 or ARM64 builds. |
| Storage | Allow room for the extracted app, the ZIP during extraction, local previews and your session originals. RAW plus JPEG uses more space than JPEG alone. |
| Camera control | Compatible x64 Canon EDSDK components installed separately by the user and a USB data connection. Official Canon software, including EOS Utility or Picture Style Editor, can supply a suitable runtime depending on the release. |
| Web Remote | A mobile or desktop browser on a trusted local network with access to the host’s selected private interface. |
| Development | Windows x64, Node.js 24 with npm, and Git for cloning. An SDK is optional for builds and mock tests. |

Current controlled evidence includes N2 lifecycle without a camera (init=0, terminate=0), H1A count-only enumeration with an **EOS 2000D over USB** (one camera, five raw zero returns), and an explicitly authorized read-only H1 cycle. H1 read firmware **1.3.0**, the Sigma 17–70mm lens, battery **80%**, and **M / ISO 400 / f/22 / 1/320 / Auto WB**. Session/lifecycle returns were zero; natural worker/Electron exit and an empty supervised Job tree were confirmed. The raw runner outcome remains **UNKNOWN** after five NVIDIA DriverStore module-location findings, with Valid signatures observed in post-run checks. The earlier blocked launcher attempt is retained separately. H2/H3 are NOT RUN. Exact source/addon identities and limits are in [hardware compatibility evidence](HARDWARE_COMPATIBILITY.md).

| Tested runtime identity | Value |
| --- | --- |
| Architecture / file version | x64 / 3.18.40.0 |
| SHA-256 | `35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627` |
| Observation date | 21 November 2026 |
| Observed scope | Lifecycle, count-only enumeration and one real read-only H1 cycle with confirmed process cleanup. H1 raw UNKNOWN is preserved for its module-location finding. Setting writes, Live View, focus, capture and transfer remain unqualified. DATA-005 is OPEN; full capture integration is held. |

The result applies to these bytes, not every file carrying the same version number or every PSE release. Other user-installed compatible EDSDK runtimes remain candidates; Apertrove does not redistribute Canon binaries or headers. Camera compatibility and supported controls depend on the body, lens, firmware and dial position. Built-in flash popup also depends on a compatible Windows WIA operation. Apertrove’s camera connection is USB. Web Remote connects the phone to the PC over the LAN.

Canon’s compatibility tables cover the SDK. Use Apertrove’s diagnostics to check the integration with your setup. [Canon SDK](https://www.usa.canon.com/support/sdk) · [Canon compatibility and release notes](https://asia.canon/en/campaign/developerresources/camera/cap/edsdk-eos-digital-camera-sdk-release-note) · [Apertrove SDK audit](EDSDK_AUDIT.ru.md)

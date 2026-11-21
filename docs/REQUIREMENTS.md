# Requirements

| Component | What you need |
| --- | --- |
| System | Windows x64. Windows 10 x64 has been used for development and portable-build checks; a clean Windows 11 installation still needs separate verification. |
| Camera | A compatible Canon camera, USB data cable, and official x64 EDSDK runtime installed separately. |
| Lens | A compatible electronic AF lens for autofocus and electronic focus steps. Other features depend on the lens and camera. |
| Disk space | Room for the application, profile, preview cache and session originals. |
| Web Remote | A browser and a trusted LAN that lets the phone reach the computer. |
| Source build | Git, Node.js 24 and npm on Windows x64. |

No camera or Canon runtime is needed for the local library, Lighting Studio, build or synthetic tests. There are no x86 or ARM64 Windows packages.

Camera availability is detected from the runtime, current camera properties and descriptors. See [Compatibility](COMPATIBILITY.md) for feature limits, and [Installation](INSTALLATION.md) for setup.

Keep the entire portable application folder together. Canon components are installed separately and retain Canon's terms. [Third-party notices](../THIRD_PARTY_NOTICES.md).

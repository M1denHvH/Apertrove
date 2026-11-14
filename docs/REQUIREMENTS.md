# System and camera requirements

| Component | Requirement |
| --- | --- |
| Operating system | Windows 10 x64 was tested on build 19045. Windows 11 x64 is a target pending a clean-machine test. Use a Windows installation that still receives your organization’s security updates. |
| Architecture | Native x64 Windows package. There are no x86 or ARM64 builds. |
| Storage | Allow room for the extracted app, the ZIP during extraction, local previews and your session originals. RAW plus JPEG uses more space than JPEG alone. |
| Camera control | An accepted x64 Canon EDSDK installation and a USB data connection. EOS Utility installation can provide a suitable local DLL, depending on the version. |
| Web Remote | A mobile or desktop browser on a trusted local network with access to the host’s selected private interface. |
| Development | Windows x64, Node.js 24 with npm, and Git for cloning. An SDK is optional for builds and mock tests. |

The project has recorded hardware tests with **Canon EOS 2000D over USB**. Canon documents related regional names and SDK compatibility for other models. Apertrove reports what the attached body and SDK actually expose. Live View autofocus, lens drive, RAW/JPEG modes, transfer targets, metering and flash can vary with the body, lens, firmware and dial position. Built-in flash popup also depends on a compatible Windows WIA operation. Apertrove’s camera connection is USB. Web Remote connects the phone to the PC over the LAN.

Canon’s compatibility tables cover the SDK. Use Apertrove’s diagnostics to check the integration with your setup. [Canon SDK](https://www.usa.canon.com/support/sdk) · [Canon compatibility and release notes](https://asia.canon/en/campaign/developerresources/camera/cap/edsdk-eos-digital-camera-sdk-release-note) · [Apertrove SDK audit](EDSDK_AUDIT.ru.md)

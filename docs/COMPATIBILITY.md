# Camera compatibility

Apertrove works with compatible Canon cameras through a separately installed **Windows x64 EDSDK**. Support depends on the camera body, firmware, lens, shooting mode and runtime together. The name on the camera is not a capability guarantee.

## Check your setup

Connect by USB, close EOS Utility and other camera applications, then open **Settings → Setup and diagnostics → Camera diagnostics**. Find the camera and run **Check capabilities**. This reads the current camera state; it does not take a photograph. Controls can be temporarily unavailable in the current shooting mode even when the camera supports them.

Select a camera mode that offers the exposure controls you need. An AF lens must be switched to AF for autofocus and electronic near/far commands. A greyed control means the current connection or camera does not offer that action.

## Features and availability

| Feature | Availability |
| --- | --- |
| USB discovery and camera information | Reported by the installed EDSDK. Some compact models have documented connection restrictions. |
| Exposure and image quality | Choices come from the camera. The mode dial and current camera state determine what can be changed. |
| Live View | Requires the camera to expose an EVF stream. Preview resolution and frame rate vary. |
| One-shot autofocus | Uses the supported focus route and reports confirmed, failed or unverified results separately. |
| AI Servo | A sustained AF command, with a separate stop action. Command acceptance does not prove optical focus or subject tracking. |
| Manual lens steps | Require a compatible electronic lens and the appropriate preview state. |
| Built-in flash | Mechanical pop-up, flash settings and firing are separate operations. A setting change does not prove the flash rose. See the interface's support message for the current connection. |
| BULB | Dedicated start/end control stays unavailable until its protocol is qualified for the runtime. Selecting a camera mode alone does not establish support. |
| Capture and camera file transfer | Implemented, with additional physical-camera validation still needed. Keep an independent copy of important originals. |
| Local photo library and Lighting Studio | Work without a camera or Canon runtime. |

Earlier observations established camera reads, exposure changes with restoration, Live View and its software histogram on one Canon EOS DSLR setup. They do not certify the whole EOS range. New Servo behavior, flash operation, BULB and capture/file-transfer changes in this development branch have been tested with simulation only.

## Runtime and connection

Obtain Canon components from Canon's official software or developer program. Keep the official installation intact. Apertrove locates the runtime in common installation folders, or you can choose its folder in Settings. An x86 DLL cannot be loaded into the x64 application.

Apertrove does not redistribute Canon DLLs or proprietary headers. An installed runtime and an exported API symbol do not by themselves establish that a particular command is supported by your camera.

Direct camera Wi-Fi control, video recording and universal support for every EOS model are outside the current feature set. **Web Remote** connects your phone to Apertrove on the computer; the camera remains connected by USB.

[Install and connect](INSTALLATION.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Canon camera API package](https://asia.canon/en/campaign/developerresources/camera/cap)

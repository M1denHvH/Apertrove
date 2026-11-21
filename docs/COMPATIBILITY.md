# Camera support

[Install and connect](INSTALLATION.md) · [Troubleshooting](TROUBLESHOOTING.md)

Apertrove is intended for compatible **Canon EOS cameras supported by the installed Windows x64 EDSDK runtime**. Camera body, firmware, lens, shooting mode and runtime all matter. A model name alone does not guarantee every control.

## Check your own setup

Close other camera software, connect the camera by USB and open **Settings → Setup and diagnostics → Camera diagnostics**. Find the camera and run **Check capabilities**. This reads current state without making a photograph. A normal working connection is separate and can configure the file destination.

A greyed control can mean the feature is unsupported, unavailable in the current mode, or temporarily busy. Exposure controls often depend on the mode dial. Autofocus and electronic lens steps also depend on the AF/MF switch and lens.

## What to expect

| Feature | What determines availability |
| --- | --- |
| USB discovery and camera details | The installed EDSDK runtime must support the device and connection. |
| Exposure, white balance and image quality | Camera-reported choices, lens and mode dial. |
| Live View | A supported EVF stream; resolution and frame rate vary. |
| Live View histogram | A decoded preview. This is a software RGB sample of its JPEG. |
| One Shot AF and AI Servo | Supported camera focus route and lens AF state. An accepted command does not establish optical sharpness or tracking. |
| Electronic near/far focus | A compatible lens and the required preview/camera state. |
| Automatic preview orientation | A supported current EVF orientation packet. Unknown or stale data falls back to manual rotation. |
| Manual preview rotation | Available in Live View; changes only the displayed preview. |
| Shutter and camera-file transfer | Implemented, with broader real-camera testing still needed. A simulated capture cannot certify physical behavior. |
| Local Library, sessions and Lighting Studio | No camera or Canon runtime required. |

Mechanical **flash pop-up** and dedicated **BULB start/end** remain unavailable in the production application. Flash mode and firing settings are not mechanical pop-up. Selecting BULB on a camera does not establish remote control support.

## Testing status

Earlier hardware observations cover a limited set of camera state reads, exposure changes with restoration, Live View and its software histogram. Those observations do not certify the full EOS range. Newer Servo, orientation and shutter workflows also have automated fake-provider tests; physical results still require testing on each relevant setup.

You can help by reporting your camera model, firmware, lens, Apertrove version, runtime version and the exact workflow. A connection report is useful even if you do not know the runtime version. [Share a result or problem](https://github.com/M1denHvH/Apertrove/issues/new?template=bug_report.yml). Do not include serial numbers or Canon binaries.

## Runtime and platform limits

Use official Canon components and keep their dependencies intact. An x86 DLL cannot load into Apertrove's x64 process. The app includes no Canon DLLs or proprietary headers and does not download them for you.

Windows x64 is the current target. There are no macOS, Linux, x86 or ARM64 app packages. Direct camera Wi-Fi, video recording and universal support for all EOS models are not current features. **Web Remote** connects a phone browser to Apertrove on the PC while the camera stays on USB.

[Canon camera API resources](https://asia.canon/en/campaign/developerresources/camera/cap) · [Requirements](REQUIREMENTS.md)

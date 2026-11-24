# Camera support

[Install and connect](INSTALLATION.md) · [Troubleshooting](TROUBLESHOOTING.md)

Apertrove supports compatible **Canon EOS cameras that work with the installed Windows x64 EDSDK runtime**. Availability depends on the camera body, firmware, lens, shooting mode and runtime. A model name alone does not guarantee every control.

## Check your camera

Close other camera software, connect the camera by USB and open **Settings → Setup and diagnostics → Camera diagnostics**. Find the camera and choose **Check capabilities** to read its current state without taking a photograph. A normal working connection is separate and can configure the file destination.

A greyed control may be unsupported, unavailable in the current camera mode or temporarily busy. Exposure controls depend on the mode dial; autofocus and electronic lens steps also depend on the lens and its AF/MF switch.

## Feature availability

| Feature | What it depends on |
| --- | --- |
| Camera discovery and details | The installed EDSDK runtime must support the camera and USB connection. |
| Exposure, white balance and image quality | Options offered by the camera, lens and current shooting mode. |
| Live View and histogram | A supported EVF preview. The histogram is calculated from the displayed JPEG preview. |
| One Shot AF and AI Servo | A supported focus route and the lens's AF state. Command acceptance does not guarantee sharp focus or subject tracking. |
| Electronic near/far focus | A compatible electronic lens and the required camera/preview state. |
| Automatic preview orientation | Current orientation data from the camera and runtime; manual rotation remains available. |
| Capture and camera-file transfer | Camera support and a working USB connection. Check that the original file reaches the selected destination. |
| Camera Card browsing and export | Supported storage operations and available card data. Thumbnails depend on what the camera provides. |
| Sessions, local Library and Lighting Studio | No camera or Canon runtime is needed. |

Flash pop-up, BULB and Camera Card controls are available only for supported camera/runtime combinations. For these functions, the initial verified configuration uses the Windows x64 Canon runtime with file version **3.18.40.0**. Other combinations may show the controls as unavailable; a matching version number by itself does not guarantee support.

Separate limited hands-on checks cover one Canon EOS 2000D with firmware 1.3.0 and one lens/runtime configuration. They do not certify other models, firmware, lenses or all camera modes. The 0.10.4 portable package itself was not tested with a physical camera. Before an important shoot, verify the first saved image and check the camera after flash or long-exposure commands.

## Platform limits

Use official Canon components and keep their dependent files together. An x86 DLL cannot load into Apertrove's x64 process. Canon DLLs and proprietary headers are not included in Apertrove.

The current package is for Windows x64. macOS, Linux, x86 and ARM64 packages are not available. Direct camera Wi-Fi and video recording are not supported. **Web Remote** connects a phone browser to Apertrove on the PC while the camera remains connected by USB.

[Requirements](REQUIREMENTS.md) · [Canon EOS software](https://www.usa.canon.com/support/eos-utilities)

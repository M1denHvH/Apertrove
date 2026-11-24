# Troubleshooting

[Installation](INSTALLATION.md) · [Camera support](COMPATIBILITY.md) · [User guide](USER_GUIDE.md)

For a camera problem, begin with **Settings → Setup and diagnostics → Camera diagnostics**. For a missing photograph, check the camera/card, session folder, Library and **Tools → Activity log** before trying another capture.

## Connect and set up

| Symptom | What to check |
| --- | --- |
| Canon runtime not found | Install official compatible x64 Canon components. Choose the folder containing EDSDK.dll and check again. |
| Runtime found but cannot load | Open **What Apertrove checked**. Check x64 architecture and keep the official installation/dependencies together. Note the version and error text. |
| Camera missing or busy | Use a USB data cable and direct port, turn it on, close EOS Utility/other camera apps, and check USB or Wi-Fi connection settings on the camera. |
| Exposure control disabled | Check the mode dial and lens. Wait for an operation to finish; use diagnostics to inspect currently offered values. |
| A different camera app stops working | Disconnect the working session in Apertrove before opening another camera application. |

## Preview, focus and shutter

| Symptom | What it means or what to try |
| --- | --- |
| Histogram empty | Start Live View and wait for a decoded frame. The chart icon opens/closes the graph; it describes that JPEG preview. An already open unavailable graph can still be closed. |
| Portrait orientation is not automatic | The current camera/runtime may not provide live orientation data. Use the clockwise rotation icon; its tooltip identifies manual versus camera orientation. |
| Camera data is available but the preview uses your angle | Manual rotation overrides automatic behavior. Use the nearby return-to-camera-orientation control. |
| AF accepted but sharpness is unverified | A command result is not proof of optical focus. Inspect the preview and saved photograph. Check lens AF/MF and camera mode. |
| Looking for the Servo switch | Open the arrow inside the AF control. When Servo is active, the main AI Servo button stops it. |
| A short click behaves like a long series | Release the input or leave the app window, then inspect the camera. The maximum hold limit is a fallback. Report the drive mode, Servo state, input method and exact sequence. Do not treat this as normal behavior. |
| Servo/shutter release is unknown | The app could not confirm the outcome. Check the camera before repeating a physical operation; follow the displayed recovery instruction. |
| Flash pop-up or BULB disabled | Development support is limited to verified runtime/camera combinations. Other connections retain unavailable controls. For BULB, also set the camera to BULB mode or choose an offered Bulb shutter setting. See [Camera support](COMPATIBILITY.md). |
| Raise-flash request accepted but position unclear | Check the physical flash. Command acceptance alone does not prove that the mechanism rose. |
| BULB time says it is waiting | The camera has not supplied an exposure-time message. The app does not replace this with a local estimate. |
| BULB stop failed or connection was lost | The exposure may still be active. Check the camera and follow recovery instructions; do not start another operation on the assumption that it ended. |

## Files and review

| Symptom | What to check |
| --- | --- |
| Camera photo missing | Preserve any card copy. Check the session output, Library and activity log. Live View/AF preview alone is not a saved photo. |
| Camera photo in an unexpected session | Open it in Library. If an association warning appears, choose **Photo session**. Delayed events can be ambiguous; reassignment does not move originals. |
| Import cannot start | Open a session and check its folder's permissions and free space. |
| RAW cannot display or looks smaller than expected | Some RAW files lack a readable embedded JPEG. The displayed detail/histogram belongs to the embedded preview. Edited RAW-to-JPEG export is unavailable. |
| Library cannot open | Read the error, check drive access, close the app and back up the profile. **Retry** does not reset the Library. Preserve records and originals before recovery. |
| Settings appear missing | Use the same Windows account. Check the current `%APPDATA%\Apertrove` profile and a legacy `%APPDATA%\Focal Studio` profile before restoring a backup. |

## Phone remote

Select a reachable private interface and use the current QR link. The phone and PC must share a trusted LAN; guest Wi-Fi may isolate devices. Check private-network firewall access. The link contains an access key, so never post it publicly. Restarting the server changes the key.

## Send a useful report

You do not need to diagnose the SDK yourself. Tell us the steps, expected result and actual result, with Apertrove and Windows versions. For camera problems, add the model, firmware, lens, shooting mode and runtime version if known. Describe whether you clicked, held, used a keyboard, or switched Servo immediately before the problem.

Remove private paths, personal images, serial numbers, network details, QR codes and remote keys from screenshots/logs. Do not attach Canon DLLs, headers or proprietary dumps. Keep a copy of the original log privately if it is needed later.

[Report a problem](https://github.com/M1denHvH/Apertrove/issues/new?template=bug_report.yml) · [Report a security issue](../SECURITY.md)

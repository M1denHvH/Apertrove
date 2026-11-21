# Troubleshooting

For camera problems, start with **Settings → Setup and diagnostics → Camera diagnostics**. For files, inspect the session folder, Library and **Tools → Activity log**.

| Problem | What to try |
| --- | --- |
| Canon runtime not found | Install official compatible x64 Canon components. Choose the folder containing `EDSDK.dll` and check again. |
| Runtime found but cannot load | Open **What Apertrove checked**. Verify x64 architecture and keep official dependencies together. Note the runtime version and error text. |
| Camera missing or busy | Turn it on, use a USB data cable and direct port, and close EOS Utility or other camera software. Check the camera's USB/Wi-Fi connection settings. |
| Exposure setting disabled | Check the camera mode and wait for an active operation to finish. Diagnostics can distinguish current unavailability from unsupported controls. |
| AI Servo reports unverified focus | The command state is separate from optical focus. Check the preview. Turn Servo off to release the held action. An unknown release requires checking the camera. |
| Histogram blank or unavailable | Start Live View and wait for a decoded frame. The software histogram samples that preview, not a saved RAW file. |
| A received photo is outside the expected session | Open it in Library. If an association warning appears, choose **Photo session**. Ambiguous delayed transfers retain their file and provenance. Reassignment does not move originals. |
| Photo missing after a camera transfer | Keep any card copy. Check the session output, Library and activity log. Do not rely on an experimental host-only transfer as your only copy. |
| Flash pop-up unavailable | A flash mode setting cannot raise the mechanism. No mechanical operation is dispatched unless a qualified route is available. Use the camera's own controls where appropriate. |
| BULB unavailable | Dedicated BULB control has not been qualified for this runtime. Apertrove does not substitute a long ordinary shutter press. |
| Import cannot start | Open a session first. Verify its folder is writable and has space. Some RAW files have no readable embedded preview. |
| Library cannot open | Read the error, check drive access, close the app and back up the profile. Retry does not reset the library. Preserve existing records and originals before recovery. |
| Settings seem missing | Use the same Windows account. Check both `%APPDATA%/Apertrove` and a legacy `%APPDATA%/Focal Studio` profile before restoring a backup. |
| Phone cannot reach Web Remote | Select a reachable private interface, use the current QR link and check private-network firewall access. Guest Wi-Fi can isolate devices. |

**Unknown** means the application could not confirm the outcome. Keep received files, inspect the camera and avoid assuming that a physical operation ended.

When reporting a problem, include the app and Windows versions, steps, expected and actual behavior, and the camera/runtime combination when relevant. Remove personal paths, serial numbers, access keys, QR links and private photos. Do not post proprietary SDK files.

[Installation](INSTALLATION.md) · [Compatibility](COMPATIBILITY.md) · [Report a bug](https://github.com/M1denHvH/Apertrove/issues/new?template=bug_report.yml) · [Security reporting](../SECURITY.md)

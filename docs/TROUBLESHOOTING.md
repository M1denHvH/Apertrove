# Troubleshooting Apertrove

Check **Settings** → **Setup and diagnostics** → **Camera diagnostics** for runtime and camera problems. For imports and transfers, check **Tools** → **Activity log** and the session folder. [Setup instructions](INSTALLATION.md)

| Symptom | What to check |
| --- | --- |
| Canon EDSDK cannot be found | Install official Canon software that supplies compatible x64 components for your model, or obtain the official SDK. In setup, choose the folder containing `EDSDK.dll` and select **Check again**. |
| The SDK is found but fails to load | Open **What Apertrove checked** in the SDK check. Make sure the runtime is x64 and its dependencies are intact in the official installation. If it loads but initialization fails, keep the SDK file version and the error text for a report. |
| The camera is missing or busy | Turn it on, use a USB data cable and try a direct USB port. Close EOS Utility, Picture Style Editor and other camera software. If Canon Webcam Utility is installed, check whether its background service is holding the device. Wait for in-camera writes to finish, then use **Find cameras** in diagnostics. |
| Live View or an exposure setting is unavailable | Confirm the camera is connected for work and that an active session is open. Check the camera mode and wait for an active capture, transfer or series to finish. Camera diagnostics can show which controls are available, temporarily unavailable or unsupported. |
| Autofocus is unverified | Use a compatible lens switched to AF and enable Live View when required. An accepted focus command can still leave the image soft, so check the preview. An unverified result gives no confirmation of focus acquisition or lens movement. |
| Import cannot start | Open or create a session first. Check that its folder is writable and has room for the photos. JPEG, PNG, TIFF and supported camera RAW files can be imported. A RAW file may have no readable embedded preview. |
| A camera transfer was acknowledged but the photo is missing | Check the session folder, Library and the activity log. Keep any card copy and any files already received. DATA-005 remains open. Apertrove sends Canon's download-complete acknowledgement before writing the file and registering it in the library. Avoid relying on a host-only transfer as your sole copy. |
| The app couldn’t open the library | Read the startup error and check the drive and permissions if it says the library is unreadable. Retrying will not reset the library. If the app says a prior library was found, close it and back up the profile before inspecting or restoring anything. Preserve the existing library and your originals. |
| Settings appear to be missing | Use the same Windows account and make sure the profile folder is writable. Check both the `Apertrove` and legacy `Focal Studio` folders under `%APPDATA%` before restoring a backup. |
| Web Remote cannot be opened on your phone | Start the server on the PC’s private network interface and use the current QR link. Connect both devices to the same trusted LAN. Check that Windows Firewall permits the connection on that private network. Guest Wi-Fi often blocks access between devices. |

If a camera operation or shutdown reports **Unknown**, retain any files that already arrived and check the camera and session state before retrying. Unknown means Apertrove could not confirm the result.

If you report a problem, include the Apertrove version, Windows build, camera model, shooting mode, SDK file version if known, and steps to reproduce. Remove serial numbers, access keys, active QR links, private paths, and photographs before sharing. [Report a security issue](../SECURITY.md)

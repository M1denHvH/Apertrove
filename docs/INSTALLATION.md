# Install Apertrove

## 1. Download and verify

Download `Apertrove-0.10.3-Windows-x64.zip` and `SHA256SUMS.txt` from the same GitHub release. In PowerShell, open the download folder and run:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\Apertrove-0.10.3-Windows-x64.zip'
```

Compare the hash with the line for that ZIP in `SHA256SUMS.txt`. If it differs, download a fresh copy from the release page.

## 2. Extract and open

Extract the ZIP to a folder you can write to, such as Documents. Open `Apertrove.exe` inside the extracted folder. The release is portable and unsigned. Windows may show a Microsoft Defender SmartScreen reputation prompt. Follow your organization’s security policy if the executable is blocked. Keep the executable, `resources`, `locales` and the other files together.

Windows x64 is required. The release was checked on Windows 10 x64. Windows 11 x64 is a target pending a clean-machine test. [System requirements](REQUIREMENTS.md)

## 3. Set up Canon components

For camera control, install official Canon software for your exact model and region that supplies compatible x64 EDSDK components, or obtain the SDK through the [Canon developer program](https://www.usa.canon.com/support/sdk). [EOS Utility](https://www.usa.canon.com/support/eos-utilities) and Picture Style Editor are potential sources; availability, architecture and terms vary by release. Apertrove does not bundle or download Canon DLLs or proprietary headers.

Apertrove checks standard Canon installation directories, including EOS Utility and Picture Style Editor under Program Files. You can also select the folder containing a compatible `EDSDK.dll`. Keep that official installation and its dependencies intact; do not copy a DLL from another installation or an unofficial download site. A 32-bit DLL cannot load in the x64 app.

On 21 November 2026, one PSE x64 runtime, file version 3.18.40.0, passed N2 initialize/terminate with raw codes `0`/`0`. H1A counted one camera with an EOS 2000D connected over USB. A separately authorized H1 attempt subsequently read firmware 1.3.0, the Sigma 17–70mm lens, battery 80% and exposure settings; session/lifecycle returns were zero and worker/Electron cleanup was confirmed. The raw H1 result remains **UNKNOWN** because a strict module-location filter flagged five NVIDIA DriverStore DLLs; all five signatures were Valid in post-run checks. The earlier pre-SDK launcher failure remains recorded. H2 recorded descriptor-backed exposure restoration, 1056×704 Live View around 27.5 FPS, histogram ON/OFF and separately authorized AF/near/far command acceptance with focus unverified; [H2 evidence](H2_VALIDATION.md) preserves the first UNKNOWN and later recorded continuation. H3 remains untested. [Compatibility evidence](HARDWARE_COMPATIBILITY.md) records the exact identities, commits and limits; these results do not qualify all PSE versions or camera operations.

Use the diagnostic screen to confirm that the library loads. If the SDK is missing or incompatible, you can skip camera setup and use sessions, local import, and Lighting Studio.

## 4. Connect and check qualification

1. Exit EOS Utility, Picture Style Editor and any other camera host, including tray launchers that open a connection. A Canon Webcam Utility background service can also hold the camera; see [troubleshooting](TROUBLESHOOTING.md).
2. Turn on the camera and connect it directly with a USB data cable.
3. Choose **Find cameras** in Apertrove and select the detected camera.
4. Create a session, pick a writable output folder, and select a destination that includes the computer if you want incoming files in Apertrove.
5. Check the [current qualification status](HARDWARE_COMPATIBILITY.md) before using camera controls. Capture and durable camera handoff remain unqualified while DATA-005 is open. This baseline issue does not itself block review of verified controls/read-only/UI changes; final merge still needs the agreed scope, checks and user confirmation. Use local import for existing photos, and reserve new isolated test frames for an explicitly scoped capture test.

Keep the application and your photo folders separate. Before replacing a portable build, back up the original photos and local Apertrove/Focal Studio application data. [Troubleshooting](TROUBLESHOOTING.md)

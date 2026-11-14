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

For camera control, obtain [EOS Utility](https://www.usa.canon.com/support/eos-utilities) from Canon for your exact camera and region, or obtain the x64 SDK through the [Canon developer program](https://www.usa.canon.com/support/sdk). Availability and terms vary. Apertrove checks standard Canon installation directories, including `Canon\EOS Utility\EU3` under Program Files. The wizard also accepts the directory containing the compatible `EDSDK.dll`. A 32-bit DLL cannot load in the x64 app.

Use the diagnostic screen to confirm that the library loads. If the SDK is missing or incompatible, you can skip camera setup and use sessions, local import, and Lighting Studio.

## 4. Connect and take a test frame

1. Exit EOS Utility, including its tray launcher if it opens a connection.
2. Turn on the camera and connect it directly with a USB data cable.
3. Choose **Find cameras** in Apertrove and select the detected camera.
4. Create a session, pick a writable output folder, and select a destination that includes the computer if you want incoming files in Apertrove.
5. Try a single test shot and check the session folder and library.

Keep the application and your photo folders separate. Before replacing a portable build, back up the original photos and local Apertrove/Focal Studio application data. [Troubleshooting](TROUBLESHOOTING.md)

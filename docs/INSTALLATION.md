# Install and connect

[Documentation](README.md) · [User guide](USER_GUIDE.md) · [Руководство на русском](STUDIO.ru.md)

You can start with a local photo library and add a camera later. Apertrove currently targets Windows x64; see [Requirements](REQUIREMENTS.md).

## Download the portable app

The published release is **0.10.4, dated 24 November 2026**.

1. Open the [release page](https://github.com/M1denHvH/Apertrove/releases/tag/Latest). Download `Apertrove-0.10.4-Windows-x64.zip` and `SHA256SUMS.txt` from the same release.
2. Calculate the archive's hash in PowerShell and compare it with its line in the checksum file:

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath '.\Apertrove-0.10.4-Windows-x64.zip'
   ```

3. Extract the **entire ZIP** to a folder you can write to. Open **Apertrove.exe** there and keep the other files and subfolders alongside it. Moving only the EXE will break the portable app.

The application is unsigned, so Windows may show a reputation prompt. Follow your organization's policy if it blocks the application. Back up your originals and local profile before replacing an existing copy.

## First launch without a camera

Choose your language and appearance on the welcome screen. You can skip Canon setup, create a session and import existing photographs. Sessions, Library and Lighting Studio need no Canon runtime.

Reopen the wizard from **Settings → Setup and diagnostics → Setup guide**. The interactive tutorial is available there too.

![Apertrove welcome screen in an isolated demo profile](screenshots/welcome.png)

## Install Canon components

For camera controls, install an official compatible **Canon EDSDK x64 runtime** separately. Obtain it through Canon's software or developer program for your camera and region. EOS Utility or Picture Style Editor may supply suitable components depending on the release. Keep their installation and dependent files together; do not copy a random DLL from an unofficial download.

[Canon EOS software](https://www.usa.canon.com/support/eos-utilities)

Apertrove searches common Canon installation directories. If needed, use **Choose SDK folder** in setup, or the custom EDSDK x64 folder under **Settings → Canon connection**, then check again. A loaded library confirms that Apertrove can load that runtime; camera capabilities are a separate check.

## Connect the camera

1. Close EOS Utility and other applications that could own the camera. Turn the camera on and use the required USB connection mode, if the model has one. Plug it directly into the PC using a USB data cable.
2. In **Settings → Setup and diagnostics → Camera diagnostics**, select **Find cameras**, choose the camera and run **Check capabilities**. This reads its current state and does not take a photograph. Use **Check SDK** for runtime loading problems.
3. Finish diagnostics before opening a working connection. Select the camera from **Choose camera** in the app header.
4. Create or open a session, confirm its folder, and open **Capture**. Start Live View when available.

A working shooting connection can configure **Card and computer** or **Computer only**, depending on camera support. Check the destination on Capture. Keep an independent card copy while evaluating file-transfer behavior when your camera supports it.

Choose a camera mode that makes the controls you need writable. For autofocus, switch a compatible AF lens to AF. Availability changes with the body, lens, mode and runtime; [Compatibility](COMPATIBILITY.md) explains these limits.

## Continue with your first shoot

The [user guide](USER_GUIDE.md) covers preview controls, the AF menu, manual/automatic orientation, shutter input, session organization and photo review. If setup fails, [Troubleshooting](TROUBLESHOOTING.md) starts with the checks that help distinguish a connection problem from an unavailable feature.

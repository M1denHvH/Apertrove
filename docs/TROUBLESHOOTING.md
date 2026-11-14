# Troubleshooting Apertrove

| Symptom | What to check |
| --- | --- |
| EDSDK cannot be found | Install official Canon software for your model, then re-run the Canon components check. If the x64 SDK is elsewhere, select the directory containing `EDSDK.dll`. |
| An SDK is found but initialization fails | Read the diagnostics for architecture, load or export errors. Select an intact official x64 installation with its matching dependencies. Record the reported library version and SDK code if you ask for help. |
| Camera does not appear | Turn it on, use a USB data cable and try a direct USB port. Close EOS Utility and any other tethering app, then use **Find cameras** again. |
| Camera is reported busy | Wait for in-camera writes and transfers. Exit EOS Utility and retry the connection. |
| Live View or a setting is disabled | Check whether the camera advertises it in the current dial mode. For lens drive and autofocus, confirm the lens is switched to AF. Stop an active burst, transfer or interval run before trying again. |
| No shot arrives in the library | Open a photo session, check its writable folder and choose a destination that includes the PC. If the camera saves only to the card, use card import or local import. A failed autofocus attempt may also prevent release. |
| Web Remote cannot be opened | Use the QR link from the active server, put both devices on the same trusted LAN, and confirm Windows Firewall allows the app on that private network. Guest Wi-Fi client isolation can block the connection. |
| Settings disappeared | Use the same Windows account and check that its application data folder is writable. Apertrove may reuse an existing Focal Studio profile. Keep a backup of the profile and your originals before troubleshooting. |

Before posting a report, remove serial numbers, access keys, QR links, private paths, and images. Include the Apertrove version, Windows build, camera model, SDK file version if known, shooting mode, and steps to reproduce. [Install guide](INSTALLATION.md) · [Security reporting](../SECURITY.md)

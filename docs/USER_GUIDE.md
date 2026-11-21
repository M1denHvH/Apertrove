# Work with Apertrove

Start with a session, then move between **Capture** for the camera and **Library** for your photographs. You can use Sessions, Library and Lighting Studio without a camera. [Installation](INSTALLATION.md) covers Canon setup.

Screenshots use a demo profile and simulated camera data.

## Create or resume a session

Open **Sessions → Create session**, enter a name and choose a writable folder. Add a client or notes if useful. Enable a dated subfolder to keep separate shoots apart.

**Resume shooting** opens the session's Capture view. **Photos** opens its Library filter. Changing a session folder affects future incoming files; existing originals stay where they are.

![Sessions](screenshots/sessions.png)

## Connect and compose

Use **Choose camera** to open a working connection. Read-only **Camera diagnostics** under Settings is a separate check. A working connection may configure the camera's save destination.

Open **Capture → Start Live View**. The preview toolbar offers zoom, grid and **Composition guides**. Guides describe framing but do not crop your originals. **Edit panels** shows, hides and reorders workspace panels.

The small chart icon in the Live View histogram container toggles the software RGB histogram. Its pressed state means enabled; the tooltip describes the control. The histogram needs an active, decoded preview. It describes the JPEG preview, rather than RAW sensor values.

Choose exposure values under **Shooting settings**. Writable choices come from the camera and depend on its mode dial. White balance, image quality and other controls follow the same rule.

![Capture and controls with a simulated camera](screenshots/workspace.png)

## Focus

**AF** performs one bounded autofocus attempt. A command can be accepted without a confirmed focus result; check sharpness in the preview.

**AI Servo** starts a sustained focus command and remains active until you turn it off. It does not wait for a one-shot focus result. The interface distinguishes an accepted command from confirmed optical focus, which the command alone cannot prove. Release it before starting an incompatible action. If release cannot be confirmed, check the camera before continuing.

**Nearer** and **Farther** send electronic lens steps where supported. Lens AF/MF state and camera mode affect availability. [Camera compatibility](COMPATIBILITY.md)

## Capture, flash and long exposures

The ordinary **Take photo** action, interval tools and preset series require a supported working connection. Keep independent originals while evaluating camera-file transfers.

A flash setting, mechanical pop-up and flash firing are different operations. The interface shows mechanical pop-up as unavailable when no qualified mechanism is available. It will not claim the flash rose because a transport request succeeded.

Dedicated **BULB** control is currently unavailable for the unqualified production protocol. It is not emulated by holding ordinary shutter control for a chosen duration. Where a qualified provider supplies it, the UI has explicit start/stop states and shows elapsed time only from camera events. Do not use a greyed control as a reason to force a camera command.

## Know where a photo belongs

Apertrove announces a received photo after the original has been written and the library entry committed. The latest received item and Library refer to that committed record.

Transfers keep their delivery context across asynchronous work. If a delayed camera event could belong to more than one session, the photo is retained and marked for attention. Open the image in **Library** and use **Photo session** to assign it. If its original session was removed, the original association is retained for review. Reassigning a session changes organization; it does not move the file.

A Live View frame or a focus preview is not a saved photograph.

## Import, review and export

Open a session, then use **Import** or **Ctrl+I** to copy existing photos into it. In Library, search filenames, filter by session or choose **Top rated**.

Open a photo to inspect it. Keys **1–5** set a rating and **0** clears it. The viewer offers exposure, contrast, saturation, warmth, monochrome and rotation adjustments. **Save edits** stores those adjustments without rewriting the original. **Export JPEG** creates a separate image; **All metadata → JSON** exports metadata. Edited RAW-to-JPEG export is unavailable, and RAW viewing depends on an embedded preview.

Read deletion confirmations carefully. Removing library entries and moving eligible originals to the Windows Recycle Bin are separate consequences.

![Library](screenshots/library.png)

## Shot Inspector

Choose **Open Shot Inspector** in Capture or Library to open the review window on another monitor. It follows registered camera transfers. Pin a frame to pause updates; use **Fit** or **100%**, metadata and the image RGB histogram. Imported local files remain available in the Library viewer.

At 100%, the displayed image maps to physical screen pixels. For RAW files with an embedded JPEG, the view and histogram refer to that preview.

![Shot Inspector](screenshots/inspector.png)

## Presets and tools

In **Presets**, save a named set of settings, edit or duplicate it, and export/import JSON. Applying it uses the values the current camera accepts. Kelvin remains a camera descriptor control rather than an invented static preset list.

**Preset series** queues settings and repeat counts and attempts to restore the original settings after a run. **Tools** includes interval controls and the activity log.

**Watched folder** imports new supported files written by another application. Open a target session, choose a separate incoming folder and select **Start auto import**. The incoming and output folders must not contain one another. Existing files and subfolders are not scanned.

## Lighting Studio and Equipment

In **Lighting**, choose a base color, compare harmonies and save palettes. Explore lighting setups and recipes to plan a shoot. Colors are guides; the actual result depends on the light, surface and white balance.

**Equipment** displays details available from the camera and lens. Manufacturer reference information and images may be fetched externally. [Privacy](PRIVACY.md)

## Web Remote

In **Web Remote**, select the computer's private network interface and start the server. Scan the QR link from a phone on the same trusted LAN. The link authorizes access while the server runs; keep it private and stop the server when finished.

The camera stays connected to the PC by USB. The remote uses a restricted set of camera commands and does not automatically expose every desktop feature.

## Make the workspace yours

**Settings** contains language, light/dark/system theme, Studio / Canon Classic / Modern appearance, accent color, Performance Mode and file storage. **Setup and diagnostics** reopens the setup wizard and interactive tutorial.

[Compatibility](COMPATIBILITY.md) · [Troubleshooting](TROUBLESHOOTING.md)

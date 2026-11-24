# Changelog

## 0.10.4

- Add camera-card browsing in Library with lazy folder listing, real camera thumbnails when available, preview tiles, metadata placeholders and explicit import/export actions.
- Keep ordinary autofocus failures scoped to the focus operation, restore controls after a failed attempt and show concise focus feedback.
- Preserve camera-session recovery and held-control safeguards while keeping detailed diagnostics in the activity log.

## 0.10.3

- Add an English interface alongside Russian. Choose the language in setup or Settings and synchronize the main window, Shot Inspector and Web Remote.
- Update Electron and Sharp in the public release copy and verify the portable Windows x64 build with isolated user data.
- Animate the onboarding iris continuously over a 4.5-second cycle and pause it when its window is hidden or minimized.
- Choose the theme, style and accent during the welcome step. New profiles follow the system theme from the first paint.
- Add a persistent Performance Mode that simplifies decorative effects across windows and the web remote.

## 0.10.2

- Share the selected theme, design and accent across setup, the main window, Shot Inspector and the web remote.
- Give setup a dedicated scroll area, adaptive equipment details and storage panels, and theme-aware optics.
- Unify motion timing across navigation, controls, dialogs, library, Shot Inspector and Lighting Studio. Keep the Live View canvas out of transitions.

## 0.10.1

- Refine first-run setup with an animated iris, dark green onboarding palette, responsive progress and illustrated SDK, USB, storage and completion states.
- Rewrite setup and tutorial copy. Improve the camera summary, capability groups, status labels and keyboard feedback.

## 0.10.0

- Add a resumable seven-step first-run guide, SDK and camera diagnostics, folder validation, and a tutorial that highlights the actual controls.
- Verify Canon SDK loading, initialization, architecture and file version. Separate read-only discovery from working connection and destination setup.
- Read camera storage information where the SDK exports the API, and enable metering changes when the camera advertises valid choices.

## 0.9.0

- Add Lighting Studio with six calculated harmonies, saved palettes, seven interactive lighting diagrams and five creative presets.
- Add Shot Inspector as an independent window that follows new camera transfers, with pinning, fit and pixel-accurate zoom, panning, and a collapsible technical panel.
- Read original metadata and calculate a display RGB histogram in an isolated background process. Show RAW using the embedded JPEG when the decoder can extract it.

## 0.8.2

- Уплотнили интерфейс съёмки, перенесли создание фотосессии к поиску и сгруппировали фильтры библиотеки.
- Добавили прямой запуск Live View из пустого видоискателя и более заметные состояния управления с клавиатуры.
- Добавили короткие переходы для диалогов и отклик на действия с учётом системной настройки уменьшения движения.

## 0.8.1

- Add photo deletion from library cards and the viewer with confirmation and Windows Recycle Bin support.
- Add selection mode, select-all for current filters, Ctrl+A, Delete and bulk deletion. Preserve failed items for retry and advance the viewer after removing a photo.
- Share registered-file trash/cache cleanup with session deletion; retain sessions, shared originals and unselected files. Wait for pending image processing before deletion.

## 0.8.0

- Synchronize the LAN remote with desktop design, theme, accent colour and the computer-resolved system appearance without a reload, including the login screen.
- Share appearance normalization, contrast rules, palette CSS and Classic seven-segment readouts between desktop and remote. Serve bundled Manrope fonts locally.
- Rebuild responsive remote panels and keep capture controls accessible on phones, tablets and desktop. Bound Live View canvas dimensions, long labels and dismissible notifications.
- Disable remote controls on connection loss and preserve the last appearance during reconnect.

## 0.7.3

- Refresh built-in flash availability after physical mode-dial changes and reconnects on desktop and LAN remote. Do not retain negative WIA probes as permanent model capabilities; preserve SDK/Live View restoration around popup.
- Add a persistent option to receive an EVF preview after successful viewfinder AF. With the option disabled, AF does not start a temporary Live View session.
- Clear stale focus previews on a new AF attempt or when disabling previews.

## 0.7.2

- Add session deletion from session cards and settings, with confirmation and an optional move of registered photos to the Windows Recycle Bin.
- Keep photos, ratings and edits in the library under Unassigned when deleting only the session. Protect shared originals and unrelated output-folder files; retain failed items for retry.
- Serialize deletion with shooting/imports and fix session-group options in the library filter.

## 0.7.0

- Isolate Live View canvas intrinsic dimensions from the capture grid; bound the inspector during window resize.
- Remove the M-mode notice; use camera-reported writable properties.
- Add native viewfinder AF via a half-press, temporary One Shot with restoration, and a fresh EVF preview without capture. Lens steps can also use a temporary Live View session.
- Keep the AF preview in memory, with real focus points, on desktop and phone. Restore EVF mode/output after preview.
- Add built-in flash popup through the Windows WIA vendor-command interface. Detect support from PTP GetDeviceInfo; serialize the SDK/WIA handoff and restore connection/Live View.
- Verify active Live View resize/maximize transitions across all designs/themes.


## 0.6.0

- Fix capture workspace/filmstrip bounds and sidebar label wrapping.
- Use keyboard-accessible themed menus instead of native desktop select popups.
- Add preset catalogue cards with pointer drag/drop, queue reordering and repeat controls.
- Replace exposure compensation with a slider over reported camera steps.
- Add EDSDK ImageQuality selection, including RAW + JPEG and camera-reported sizes.
- Automatically cache manufacturer images, prefer front camera views and prepare transparent neutral backgrounds. Always show built-in device artwork offline.
- Remove redundant headings and explanatory UI text; align preset apply buttons in all designs.
- Add original photographic SVG symbols; no Canon/Noun Project icon artwork bundled.

## 0.5.0 — Studio workflow

- Added a session home screen, custom output folders, client/notes, reopening/editing and separate saved preset queues. Legacy sessions keep original files, ratings and folders.
- Replaced permanent AF success text with SDK-derived focus points over desktop/phone Live View. Added AF mode and Live View AF method selectors, physical MF handling and variable-size focus arrays.
- Rebuilt Canon Classic LCD readouts with original seven-segment SVG artwork and black-on-green rendering in both themes. Added an exposure/colour/focus guide on the parameter information button.
- Added preset queue capture with whole-queue preflight, single-shot enforcement, exact step tagging, cancellation and restoration of initial settings.
- Added camera drive-mode controls, camera timers and held native continuous shooting with pointer/Space release and a bounded five-second request. RAW/JPEG pairs count as one capture.
- Added thirds/golden/diagonal guides, 1:1/4:5/9:16 frames and editable social safe zones, shared with the web remote.
- Added workspace editor, panel visibility/order, accessible inspector width/height resizing, saved layout and reset presets.
- Added universal SDK equipment cards, app/model statistics, manufacturer photo/specification lookup on request and honest unavailable-data fallbacks. Verified Canon EOS 2000D and Sigma 17–70mm Contemporary entries.
- Added complete readable EXIF/IPTC/XMP/ICC metadata, author/copyright search and full JSON export including binary blocks.
- Verified on EOS 2000D: one-request AF, AF method writes/readback, two preset frames at distinct ISO values, and native multi-frame continuous shooting; camera parameters restored after tests.

## 0.4.0 — Apertrove

- Renamed Focal Studio to Apertrove, with an original application icon. Existing Focal Studio libraries and preferences are retained in their established location.
- Live View AF stays engaged until fresh focus metadata confirms acquisition, with consecutive confirmation samples, a 12 second timeout and guaranteed release. Frames continue during AF. Tested on EOS 2000D without releasing the shutter.
- Added Canon Classic and Modern designs alongside Studio; all support light/dark/system themes and custom accent colors.
- Added 100 optional photographer splashes in the title bar; click to change.
- Fixed remote server port/interface persistence when reopening its settings.
- Added source export/preflight tools, GitHub upload helper, Windows CI, manual package workflow and release documentation.

## 0.3.0

- Camera selection and SDK capability handling, binary Live View, authenticated LAN remote HUD and phone controls.

## 0.2.0

- Light/dark/system themes, custom accents and verified camera property writes.

## 0.1.0

- Tethered capture, photo library/import, presets, editing and session tools.

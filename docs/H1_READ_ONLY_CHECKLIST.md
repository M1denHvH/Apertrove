# EOS 2000D H1 read-only checklist

**State: NOT RUN · BLOCKED by unqualified `EdsDeviceInfo` and `EdsPropertyDesc` output layouts.** H1 is not ready for separate hardware authorization until exact-runtime ABI evidence resolves those structures and the other UNKNOWN entries in [the ABI decision](H1_ABI_DECISION.md). This checklist is for a future H1 after the required N2 initialize/terminate experiment succeeds. It does not authorize N2 or camera access.

## Current source path

The diagnostic route is cameraDiagnose in electron/main.cjs: when the requested camera is not already connected, it calls connectCamera with readOnly true, then calls diagnoseCamera, and stores the returned report in onboarding state. A live working connection is rejected rather than relabeled read-only. The worker selects a camera, opens one session, registers object/property/state event handlers, reads identity and property values/descriptors, and builds capability rows. The optional EdsGetVolumeInfo call is deliberately skipped because its VolumeInfo layout is marked U in the ABI matrix; the report says that volume/access metadata was not queried. It does not call prepareWorkingSession, which is where EdsSetPropertyData/SaveTo and EdsSetCapacity are used. The diagnostic UI displays the saved report; cameraEndDiagnostics disconnects the session. Closing the application then runs worker finalization and SDK termination.

Synthetic onboarding tests exercise the busy retry, read-only connection, displayed report, subsequent working-connection flow, and shutdown. The focused IC01 case exercises the actual Electron main/preload/renderer and the admitted JavaScript fake provider. These tests do not verify Canon SDK semantics or EOS 2000D behavior.

The previous source-level handling gap for the EdsRetain/EdsRelease error sentinel is addressed: a zero reference count is valid; 0xFFFFFFFF or a thrown binding call is UNKNOWN. An unacknowledged release retains the opaque ref in bounded worker quarantine and blocks further native work. A thrown or invalid EdsOpenSession binding result is likewise UNKNOWN; a returned nonzero EdsError is a known failed open and does not claim a session. Focused source tests cover these cases, but they cannot prove the deployed Canon runtime ABI or live camera object lifetime. DeviceInfo, PropDesc, EdsAccess width and property data formats remain U in the ABI matrix. EdsGetVolumeInfo is explicitly not called by H1 because its output layout remains U. H1 must remain NOT RUN until the exact runtime/header ABI relevant to camera discovery and property descriptors is matched or otherwise qualified; skipping VolumeInfo alone does not qualify the remaining structures. No native object layout is inferred from a fake provider.

## Procedure after N2 and separate H1 approval

1. Record the exact Apertrove commit, Windows version/architecture, installed runtime path/product version/SHA-256, and verified addon identity. Keep the report and all raw codes local; redact camera serial and USB identifiers before sharing.
2. Confirm the EOS 2000D is powered, Wi-Fi is off, the USB cable is direct and stable, and EOS Utility or any other camera host is closed. Record firmware, lens/adapter, lens AF/MF switch, shooting mode, battery, card presence, and the camera's current save destination without changing them.
3. Start a fresh Apertrove process after the successful N2 process has exited. Select only the intended EOS 2000D in Camera Diagnostics and run Check capabilities. Do not use the working Connect action.
4. Save the returned identity, firmware, lens, battery, SDK identity, each property value, descriptor result/value count, capability status, and raw error code. Explicitly record volume access information as NOT QUERIED until its ABI layout is qualified. Record empty or unsupported descriptors as observations for that camera/mode.
5. Confirm the report is from the selected EOS 2000D and the connection remains working:false with no SaveTo destination configured by Apertrove. Do not choose or import card files.
6. Close Diagnostics to close the camera session, then quit Apertrove normally so the worker can finalize and exit. Preserve lifecycle logs and the local report. If teardown is reported UNKNOWN, stop; do not retry in the same process or relabel the result as clean.
7. Compare only the before/after observations. Do not write properties to restore anything: this step must not change camera settings, destination, EVF, AF, shutter state, or card contents.

## Explicitly out of scope

This route reads camera identity and property values/descriptors. Volume access is **NOT QUERIED** because `EdsVolumeInfo` remains ABI-unqualified. It does not intentionally write a property or SaveTo/Capacity, start EVF, autofocus, drive the lens, release the shutter, import/delete card files, or write to the card. It does open a logical camera session and registers event handlers; it is not a disconnected or zero-communication test. Any unexpected change, property-write attempt, capture event, transfer, or unresolved worker teardown is a stop-and-review result.

Record H1 outcome per behavior as DEVICE-TESTED PASS, DEVICE-TESTED FAIL, DEVICE-TESTED UNKNOWN, or NOT RUN, keeping source/documentation expectation separate. One EOS 2000D result does not establish compatibility for another model, firmware, lens, or runtime.

## Live View histogram note

The current product histogram is software-only: it samples already decoded EVF JPEG frames at most every 250 ms, downsamples to at most 160×120 pixels, keeps only the newest pending frame, and computes RGB bins without an additional Canon command, FFI binding, camera session, or outbound image transfer. It is an estimate of the displayed JPEG preview, not a Canon-native or RAW exposure histogram. The toggle should be tested independently with synthetic RGB fixtures and with EVF stop/disconnect/empty-frame cleanup; it is outside the read-only H1 camera qualification result.

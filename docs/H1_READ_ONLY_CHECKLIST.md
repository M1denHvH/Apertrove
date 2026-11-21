# EOS 2000D H1 read-only checklist

**Current raw result: UNKNOWN, with real H1 reads and normal cleanup recorded.** After the first pre-SDK launcher block, a separately authorized retry read EOS 2000D firmware 1.3.0, lens, battery, current properties and descriptors. The final runner finding was five GPU-driver module locations; separate signature review and raw UNKNOWN are retained independently. See [hardware evidence](HARDWARE_COMPATIBILITY.md).

This checklist does not authorize another attempt. Review the preserved H1 evidence and module finding; obtain a new operation-specific approval before any further native stage. Do not rerun a completed lifecycle or read-only attempt merely to obtain PASS.

## Current source path

`cameraDiagnose` uses actual main/preload/worker code, rejects an existing working connection, connects with `readOnly:true`, reads the report and saves it in the isolated diagnostic profile. Canon object/property/state handlers are registered only by `prepareWorkingSession`. H1's local Koffi trampolines are not passed to Canon, preventing a read-only transfer callback from issuing `EdsDownloadCancel`.

The route uses justified DeviceInfo/PropertyDesc layouts and bounded property buffers. It does not call working-session setup, property writes, SaveTo, Capacity, EVF, focus, shutter or card import. Volume access is **NOT QUERIED** because `EdsVolumeInfo` remains ABI-unqualified. Unsupported properties are recorded; native exceptions, invalid returns, unsafe outputs and uncertain cleanup stop the stage.

## Protocol for any separately authorized future attempt

1. Pin source, built renderer, Electron, addon and Canon runtime bytes. Require fresh ready:true, blockers:[] and empty NODE_OPTIONS/NODE_PATH; never reuse a consumed manifest.
2. Confirm the intended EOS 2000D is powered and USB-connected and conflicting Canon clients are stopped. Passive OS identity is supporting evidence, not an SDK model/firmware result. Keep originals and the user's profile outside the diagnostic workspace.
3. Assign the actual gated Electron PID to the independent Job supervisor before releasing production main, including startup-descendant coverage. Failed assignment or startup blocks SDK admission.
4. Run one bounded Camera Diagnostics cycle. Record model/firmware/lens/battery, raw property values, descriptor codes/counts and capability statuses. Keep serials, USB identifiers, user paths and raw QA evidence private.
5. Confirm working:false, eventsRegistered:false, no SaveTo configured by Apertrove, no live preview and no mutating Canon call. Close Diagnostics and quit normally within the deadline.
6. Preserve raw calls, unload/COM receipts, worker/supervisor reports, Before/During/After observations and independent exit verification. A kill request alone is not exit proof. Stop after crash, UNKNOWN, unexpected camera state or ambiguous cleanup; do not retry silently.

Do not write properties to “restore” H1: its intended scope changes no exposure, destination, EVF, AF, shutter or card data. Opening/closing a diagnostic session is real camera communication. One EOS 2000D result cannot certify other models, firmware, lenses or runtimes.

## Live View histogram

The software RGB histogram consumes decoded EVF JPEG frames at most every 250 ms and at most 160×120 pixels. It estimates the displayed preview, not Canon-native or RAW exposure. Synthetic UI tests do not prove actual EVF delivery; native Live View/histogram testing belongs to separately approved H2.

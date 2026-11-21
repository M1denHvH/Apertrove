# EOS 2000D H2 — actual controls and Live View observations

Recorded **21 November 2026** for Canon EOS 2000D firmware **1.3.0**, USB, and the Sigma 17–70mm lens identified in [hardware compatibility evidence](HARDWARE_COMPATIBILITY.md). The pinned user-installed PSE x64 runtime is EDSDK.dll **3.18.40.0**, SHA-256 `35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627`; Koffi is **2.16.3**. Results apply to this combination and camera state.

Two separately authorized scopes produced different raw results. The first FULL run remains **UNKNOWN**. The later FOCUS_ONLY continuation recorded **H2_CONTROLLED_SERIES_RECORDED**. The later result does not rewrite the earlier receipt or certify optical focus, capture, transfers or all Canon models.

## Exposure and Live View — first FULL scope

Exact source: `f34f8bb7e61c029735a7865e4b82e518f3eee9b7`. Initial settings were read again before mutation: M, ISO 400, f/22, 1/320 s, Auto WB. Each exposure target came from the camera's descriptor; all six set calls and their readbacks returned zero.

| Property | Initial | Target / readback | Restored / readback |
|---|---|---|---|
| ISO | 400; raw 88 | 200; raw 80 | 400; raw 88 |
| Tv | 1/320 s; raw 123 | 1/400 s; raw 125 | 1/320 s; raw 123 |
| Av | f/22; raw 80 | f/20; raw 77 | f/22; raw 80 |

White balance was read-only. Exposure compensation was not exercised in M, and Kelvin was not queried outside the appropriate WB mode. The physical mode dial was not changed.

| Live View observation | Recorded measurement |
|---|---|
| First decoded frame | 1.316 s after the start request; JPEG decoded/drawn at **1056×704** |
| Renderer frame arrivals | 145 frames spanning 5.233 s; **27.518 FPS**, calculated from the 144 inter-frame intervals |
| Decoded preview samples | 144 decoded frames in the recorded sample; observed rate **27.489 FPS** |
| Approximate software transport interval | About **4 ms** from available worker/renderer timestamps; excludes optical, exposure and full camera-to-screen latency |
| Histogram | Existing software JPEG RGB histogram displayed four SVG paths and toggled ON/OFF; source cadence limited to about 250 ms, not a Canon-native or RAW histogram |
| Stop / destination | EVF output restored to **0**, EVF mode to **1**; camera SaveTo remained **1** (card). Apertrove's control-only `saveTo:null` means it did not configure a transfer destination. |

The run stopped **before AF or lens drive** with `H2_STATE_CHANGED_BEFORE_AF`. During Live View, native reads changed AF mode `0x404` from 2 to 0 and metering `0x403` from 4 to 3. The stop restored/read back EVF output/mode but returned cached camera properties; it did not read AF/metering again before the baseline comparison. Their actual post-stop state in this first run therefore remains unknown. The user's later observation of **AI FOCUS outside Live View** is a manual observation, not a fresh SDK read for that receipt. No AF/metering write or AF/lens command occurred, and the original aggregate UNKNOWN is retained.

## Corrections and separately authorized FOCUS_ONLY continuation

`925edfd` refreshes control-only state after a successful Live View stop. `62ca324` lets an already acknowledged stop perform a read-only refresh. The `3e7f87d` H2 harness bounds subsequent settlement to one second without another EVF mutation or a relaxed baseline; that deadline is not imposed by the production refresh method itself. Synthetic tests cover both a returning AF value and a persistent difference that must still fail. `7f05d3a` corrects the UI's previous capture-ready/computer-destination claims for control-only sessions.

The FOCUS_ONLY continuation used exact source **`3e7f87d6c9a4ae4c1c5e5d7ec2ed572f0c0161cf`**. It did not repeat exposure mutations or the earlier performance/histogram test. After fresh identity, lens/AF and Live View checks, these were the **only four EdsSendCommand calls**, each returning **0**:

| Operation | Command / parameter | Observed result |
|---|---|---|
| Live AF ON | `0x102 / 1` | One bounded attempt |
| Live AF OFF | `0x102 / 0` | Stop acknowledged with raw return **0** |
| Small near lens drive | `0x103 / 1` | SDK acceptance recorded |
| Small far lens drive | `0x103 / 0x8001` | SDK acceptance recorded |

AF returned **unverified**, `confirmed:false`, reason `FOCUS_METADATA_UNQUALIFIED`, with reported `durationMs=1019`. That duration was calculated before the finally-block OFF call completed; it is not the OFF acknowledgement latency. The restricted path does not decode the unqualified FocusInfo point layout. SDK acceptance is not evidence of optical focus accuracy or measured physical lens movement. No viewfinder/shutter half-press fallback was used.

This scope made **no exposure writes** and only three EVF writes: start output=2, restore output=0, restore mode=1. Fresh readbacks followed both restore acknowledgements. The first snapshot still showed AF=0/metering=3; one additional **read-only** refresh confirmed AF=2/metering=4 after **196 ms**, within the one-second deadline. All **18 initial/final recorded raw scalar values matched**. The stronger ordered readback proof covers **11 critical properties freshly read after both acknowledgements**: ISO/Tv/Av, WB, AF, metering, shooting mode, SaveTo, EVF output/mode and Live View AF mode. The other recorded scalar matches do not establish fresh post-stop battery/shot-counter readings. No AF/metering property was written. The controller recorded `completed:true` and **H2_CONTROLLED_SERIES_RECORDED**.

## Cleanup and safety

Both scopes recorded normal worker/Electron exit 0, balanced eight acquired refs, three released local callback trampolines, balanced COM, DLL unload and a supervised Job tree accounting six processes with zero active processes, closed handle and no forced termination. The FOCUS_ONLY independent post-check found all eight recorded PIDs, including the observer, absent. No unexpected module, binding exception or guard denial was recorded in that scope. Module observations remain samples, not proof that no transient module could ever load.

The sessions used an isolated test profile. No SaveTo/Capacity mutation, Canon file-event handler registration, shutter/capture/burst/timer, camera file download/delete, formatting or firmware operation occurred. Existing originals and the user's photo library were excluded. H3 was not executed or authorized by these H2 results. Raw receipts, logs, images, camera identifiers and machine paths remain private and are not committed.

## Integration scope

These observations support review of the bounded controls, read-only and related UI changes. Final merge readiness remains subject to the exact proposed diff, regressions, CI, independent review and the user's separate merge confirmation; this document does not declare final CI or merge approval.

DATA-005's Download → Complete → memory copy → file write → registration ordering already existed in baseline main `d7c9e02f09c89d70afdce72cd38ec99fadb05489` and was not changed by H2. The open durability concern remains a capture/H3 and release-qualification limitation; it does not automatically prohibit merging an independently verified safe controls/read-only/UI scope. Host-only capture durability, RAW/JPEG transfer, callback correlation/quiescence, package/clean-machine behavior and other bodies/lenses still require their own qualification.

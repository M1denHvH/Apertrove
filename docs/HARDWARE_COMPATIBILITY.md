# Canon hardware compatibility evidence

Recorded **21 November 2026** for one installed runtime and one camera environment. These results do not certify all Canon EOS cameras, PSE releases or camera functions.

## Identities

| Component | Recorded identity |
|---|---|
| Camera environment | Canon EOS 2000D, powered and USB-connected, confirmed by the user and passive Windows inventory. H1A counted one camera without requesting SDK device info. |
| Firmware | NOT READ: H1 did not reach SDK execution. |
| Lens | Sigma 17–70mm f/2.8–4 OS HSM, reported by the user; NOT READ or qualified through SDK. |
| Canon runtime | User-installed Picture Style Editor x64; EDSDK.dll file/product version 3.18.40.0, 1,522,576 bytes; Canon signature Valid at preflight. |
| Runtime SHA-256 | `35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627` |
| Koffi | 2.16.3, Windows x64 addon SHA-256 `1305fdf18bcb5e71c1cd0530cd0834b9858beb01606f58086e587343809bfa3b` |
| H1A source | `6e2539f9428aeab738175c888d16781aa6296b8e`; integration cherry-pick `eb937a8e17c1a5708a759d2aa5eb63c6b30ef747`. |
| Blocked H1 launcher source | `e532e041da9939d185b9c3e76f8b24bee67393ef`; integration cherry-pick `290b688cae1669b1d769d5c83bf66df20cc520a9`. |

## Actual observations

| Stage / API | Raw return | Observation |
|---|---|---|
| N2: EdsInitializeSDK | 0 | One authorized lifecycle attempt without a camera; SOURCE_ZERO_CYCLE. |
| N2: EdsTerminateSDK | 0 | DLL unload, balanced COM, natural exit and empty supervised Job tree recorded. |
| H1A: EdsInitializeSDK | 0 | One controlled count-only attempt with the camera connected. |
| H1A: EdsGetCameraList | 0 | One owned camera-list reference acquired. |
| H1A: EdsGetChildCount | 0 | Returned **cameraCount=1**. |
| H1A: EdsRelease | 0 | List released; this raw value is a reference count, not an EdsError. |
| H1A: EdsTerminateSDK | 0 | DLL unload/balanced COM recorded. Natural worker exit 0, no timeout/forced termination, signaled root, zero active Job processes and closed Job handle confirmed. |
| H1 diagnostics | NOT RUN | Electron exited 2147483651 (0x80000003) before Job assignment and production-main grant. No native worker, native trace or diagnostic report. Independent post-check found no recorded run processes remaining. |
| H2: exposure/read-back, EVF, histogram, AF/lens drive | NOT RUN | Requires successful H1 and approval of the exact operation group. |
| H3: shutter, RAW/JPEG, transfers and fault cases | NOT RUN | Requires separate approval and fresh isolated test photos. DATA-005 is OPEN. |

H1A opened no camera session and issued no property, EVF, autofocus, shutter or camera-file call. Those calls did not alter originals or configure camera settings; no SDK state comparison beyond the count is claimed. H1's failed launcher never reached its camera stage.

Periodic N2/H1A module samples saw Node, Koffi and Windows modules but missed Canon's short DLL lifetime; they are not complete dynamic dependency inventories. A nonfatal stdout-sync diagnostic was retained in raw logs. SDK returns and confirmed cleanup are separate from that diagnostic. Raw logs, manifests, USB identifiers and private paths remain outside Git.

## Remaining work

The [targeted ABI evidence](HARDWARE_ABI_QUALIFICATION.md) justifies limited H1 declarations using Canon Reference, labeled archived declarations and an independent compile-only Windows x64 probe. It is not an actual camera read. Two later synthetic-only Electron probes identified a separate bootstrap containment race: an asynchronous gate let Chromium children start before Job assignment. A bounded synchronous gate and early isolated Electron paths corrected that race in the synthetic probe (all four observed processes inside the Job, natural exit 0, empty tree); eight fake guard tests cover the updated entry. Canon, Koffi and production main were excluded from those probes. The cause of the original `0x80000003` remains unknown, and the corrected native H1 route has not been retried. Seek approval for one new H1 attempt; do not repeat N2 or advance automatically to H2/H3.

DATA-005 is the existing Download → Complete → memory copy → file write → registration gap. SDK completion and ordinary file/JSON close do not prove durable host storage. This integration does not fix the gap or qualify host-only capture; the full capture merge/release gate remains held. A smaller verified stability/read-only scope needs explicit review and final user merge confirmation. Apertrove distributes no proprietary Canon DLL/header; this fact alone does not establish use rights.

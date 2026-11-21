# H1 ABI decision — Canon read-only diagnostics

**21 November 2026: H1 recorded real read-only EOS 2000D data and a normal session/process close. The raw aggregate runner result remains UNKNOWN because five signed GPU-driver module paths were rejected by the location filter.** The separate observations and module review do not rewrite that result as PASS.

[Hardware evidence](HARDWARE_COMPATIBILITY.md) distinguishes completed N2, H1A count-only enumeration, the first blocked H1 launcher and the separately authorized real H1 retry. H1A returned one camera with five raw zero returns; actual H1 then read model/firmware/lens, current properties and descriptors in one read-only session.

## Current qualification

| Boundary | Technical evidence | Remaining limit |
|---|---|---|
| `EdsChar`, `EdsInt32`, `EdsUInt32`, `EdsBool` | Canon Reference §2.14 and Windows x64 LLP64: char 1 byte; long/unsigned long/int 4 bytes | Encoding and property-specific interpretation are separate. |
| Opaque refs and ref outputs | 8-byte pointers and pointer-to-pointer outputs, documented ownership, real H1A list/count/release | Actual H1 exercised child/device selection and one open/close session on this runtime. |
| `EdsDeviceInfo` | Size 520, alignment 4, offsets 0/256/512/516; three labeled archived declarations corroborate the binding | Actual H1 device-info calls returned 0 on this EOS 2000D/runtime. |
| `EdsPropertyDesc` | Size 524, alignment 4, offsets 0/4/8/12; current Reference and archived declarations agree on field order and extent | Actual H1 recorded 22 descriptor calls returning 0; values remain camera/mode-dependent. |
| `EdsAccess`, `EdsDataType` | 4-byte Windows enum representation; bindings preserve the physical bits | Do not infer write permission from the reserved access field. |
| Function/callback convention | Windows x64 ABI and reviewed callback parameter shapes | Callback lifetime/quiescence remain unverified; H1 registers no Canon callbacks. |

[HARDWARE_ABI_QUALIFICATION.md](HARDWARE_ABI_QUALIFICATION.md) records exact provenance and the independent compile-only MSVC probe. Its size/alignment/offset assertions passed with exit 0. No proprietary header was committed or DLL loaded by the probe. The earlier claim that a useful probe was impossible without an exact matching SDK package is superseded. An unavailable public DLL-SHA-to-package mapping is not a universal prerequisite.

## Execution boundary and result

H1 permits discovery/device info, one session, bounded property size/type/data/descriptor reads and cleanup. It does not register Canon handlers, write properties or SaveTo/Capacity, download/cancel, start EVF, focus or release the shutter. `EdsGetVolumeInfo` remains excluded because its layout is not qualified.

The first H1 launcher exited `2147483651` (`0x80000003`) before Job assignment/grant and remains recorded as BLOCKED before SDK. Later synthetic probes verified early isolated paths and a synchronous gate before a separately approved real retry. That retry read EOS 2000D firmware 1.3.0, lens, battery and properties; initialize/open/close/terminate returned 0 once each, refs and COM balanced, and the worker/Electron/Job tree exited normally. The original breakpoint cause remains unknown.

The retry's final raw UNKNOWN came from five NVIDIA GPU-process modules under Windows System32/DriverStore, outside the filter's direct-System32 rule. Separate post-run inspection recorded all five signatures Valid under Microsoft Windows Hardware Compatibility Publisher. Preserve this review separately from the immutable runner result; no native retry or PASS relabel is justified by it. See hardware evidence for exact call counts, expected nonzero property-size observations and cleanup limits.

## Attribution and limits

IC01 now checks its launcher SHA against actual Git HEAD and records/rechecks source hashes. Earlier H1/histogram reports with a mismatched launcher sourceCommit remain historical evidence, not final-HEAD certification. Synthetic tests do not qualify the physical camera or native callback lifetime.

N2 is complete and should not be repeated merely for another PASS. Separately authorized [H2 scopes](H2_VALIDATION.md) recorded exposure/Live View observations and an AF/lens continuation with focus unverified; H3 remains NOT RUN. DATA-005 remains OPEN for capture/release qualification and is not a new H2 regression. Technical compatibility and applicable local-use conditions are separate questions; user confirmation is not evidence of a Canon license grant.

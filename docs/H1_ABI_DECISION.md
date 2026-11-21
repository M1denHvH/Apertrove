# H1 ABI decision — Canon read-only diagnostics

**21 November 2026: the targeted Windows x64 ABI boundary is technically justified. H1 camera diagnostics remain NOT RUN because the attempted Electron launcher stopped before SDK admission.** The current blocker is the launcher, not the earlier blanket requirement for matching proprietary headers.

[Hardware evidence](HARDWARE_COMPATIBILITY.md) distinguishes completed N2, successful H1A count-only enumeration and blocked H1. H1A returned one camera; all five native returns were zero and the worker exited naturally with an empty Job tree. It did not request device info, open a camera session or read properties.

## Current qualification

| Boundary | Technical evidence | Remaining limit |
|---|---|---|
| `EdsChar`, `EdsInt32`, `EdsUInt32`, `EdsBool` | Canon Reference §2.14 and Windows x64 LLP64: char 1 byte; long/unsigned long/int 4 bytes | Encoding and property-specific interpretation are separate. |
| Opaque refs and ref outputs | 8-byte pointers and pointer-to-pointer outputs, documented ownership, real H1A list/count/release | H1A did not exercise child selection or sessions. |
| `EdsDeviceInfo` | Size 520, alignment 4, offsets 0/256/512/516; three labeled archived declarations corroborate the binding | Technically justified layout, not an actual H1 device-info result. |
| `EdsPropertyDesc` | Size 524, alignment 4, offsets 0/4/8/12; current Reference and archived declarations agree on field order and extent | No real descriptor results yet. |
| `EdsAccess`, `EdsDataType` | 4-byte Windows enum representation; bindings preserve the physical bits | Do not infer write permission from the reserved access field. |
| Function/callback convention | Windows x64 ABI and reviewed callback parameter shapes | Callback lifetime/quiescence remain unverified; H1 registers no Canon callbacks. |

[HARDWARE_ABI_QUALIFICATION.md](HARDWARE_ABI_QUALIFICATION.md) records exact provenance and the independent compile-only MSVC probe. Its size/alignment/offset assertions passed with exit 0. No proprietary header was committed or DLL loaded by the probe. The earlier claim that a useful probe was impossible without an exact matching SDK package is superseded. An unavailable public DLL-SHA-to-package mapping is not a universal prerequisite.

## Execution boundary and result

H1 permits discovery/device info, one session, bounded property size/type/data/descriptor reads and cleanup. It does not register Canon handlers, write properties or SaveTo/Capacity, download/cancel, start EVF, focus or release the shutter. `EdsGetVolumeInfo` remains excluded because its layout is not qualified.

The H1 launcher exited `2147483651` (`0x80000003`) before Job assignment and the production-main grant. No native worker, API trace or camera report was produced. This is **BLOCKED before SDK execution**, not a native compatibility failure or a successful H1. A cause-specific correction, safe verification and renewed user approval are required before another real attempt. No automatic retry is authorized.

## Attribution and limits

IC01 now checks its launcher SHA against actual Git HEAD and records/rechecks source hashes. Earlier H1/histogram reports with a mismatched launcher sourceCommit remain historical evidence, not final-HEAD certification. Synthetic tests do not qualify the physical camera or native callback lifetime.

N2 is complete and should not be repeated merely for another PASS. H2/H3 remain NOT RUN and require separate operation-specific approvals. DATA-005 remains OPEN. Technical compatibility and applicable local-use conditions are separate questions; user confirmation is not evidence of a Canon license grant.

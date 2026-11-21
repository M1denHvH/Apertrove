# Native ABI matrix — current H1 status and N1 inventory

**Updated 21 November 2026.** The earlier blanket UNKNOWN finding for the limited H1 types is superseded by [targeted qualification](HARDWARE_ABI_QUALIFICATION.md): current Canon Reference §2.14, corroborated archived declarations, Windows x64 ABI and an independent compile-only MSVC probe. Proprietary headers are not committed. No exact public DLL-SHA-to-SDK-package mapping is claimed or required as a universal prerequisite.

| Target | Current technical status | Runtime observation |
|---|---|---|
| `EdsChar`, `EdsInt32`, `EdsUInt32`, `EdsBool` | Canon C declarations plus LLP64 justify 1/4/4/4-byte physical widths | Actual H1 also read device/property data and completed one session; raw aggregate UNKNOWN is separately documented. |
| Opaque refs / out refs | 8-byte Windows x64 pointers; pointer-to-pointer outputs; documented ownership | H1A list/count/release and actual H1 child selection/session/ref cleanup were recorded on the pinned runtime. |
| `EdsDeviceInfo` | Size 520, alignment 4, offsets 0/256/512/516; reviewed Koffi layout agrees with three labeled archives | Actual H1: 3 device-info calls returned 0; EOS 2000D identity was read. |
| `EdsPropertyDesc` | Size 524, alignment 4, offsets 0/4/8/12; Reference/archives and compile probe agree | Actual H1: 22 descriptor calls returned 0; values remain camera/mode-dependent. |
| `EdsAccess`, `EdsDataType` | 4-byte Windows enum representation justified | Not grounds for write permission or arbitrary property decoding. |
| Function / callback convention | Windows x64 ABI and documented parameter shapes justified | Canon callback lifetime/quiescence unverified; H1 registers no Canon callbacks. |
| `EdsVolumeInfo`, card/file structures, Capacity, FocusInfo | Outside targeted H1 qualification | Observed H2 controls/EVF do not qualify these other layouts; H3 is untested. VolumeInfo is not invoked by H1. |

N2 completed SOURCE_ZERO_CYCLE and H1A counted one camera with five raw zero returns. A separately authorized H1 retry recorded camera reads and normal cleanup; its raw aggregate UNKNOWN was caused by five signed GPU-driver paths rejected by the module-location filter. The earlier pre-SDK launcher block remains historical evidence. [Actual identities, source commits and limits](HARDWARE_COMPATIBILITY.md).

The inventory below retains the broader N1 source review. R means documented reference shape; U marks remaining qualification, not a requirement to obtain impossible exact-package provenance. The targeted H1 updates above take precedence. Canon API Reference 13.20.11, SHA-256 `71c3686452af13e66ffe7bc95e40f84264d7a368288d5231ccd6999fe27bdc2b`, [official Canon-linked PDF](https://canon-industrial-imaging-production.fra1.digitaloceanspaces.com/wp-content/canon_b2b/uploads/2026/09/15132330/EDSDK_API_EN-4.pdf), is the primary reference.

## Functions

| Symbol | Existing Koffi arguments | Reference prototype shape / page | Ownership / result / status |
|---|---|---|---|
| EdsInitializeSDK | none | EdsError() p39 | Once/process in public ref; pinned N2 init=0 |
| EdsTerminateSDK | none | EdsError() p39 | Releases SDK resources; after successful init; R |
| EdsGetCameraList | out void** | CameraListRef* p42 | Implicit owned ref; release; R |
| EdsGetChildCount | void*, out uint32* | BaseRef, UInt32* p41 | Count output, not ref; R |
| EdsGetChildAtIndex | void*, int32, out void** | BaseRef, Int32, BaseRef* p41 | Implicit owned child ref; R |
| EdsGetDeviceInfo | void*, out DeviceInfo* | CameraRef, DeviceInfo* p43 | Caller struct buffer; targeted H1 layout justified; actual H1 reads returned 0 |
| EdsOpenSession | void* | CameraRef p46 | Session lifetime on camera ref; R |
| EdsCloseSession | void* | CameraRef p46 | Close before ref release; R, quiescence U |
| EdsRetain | void* | UInt32(BaseRef) p40 | Refcount, not EdsError; zero is valid, 0xFFFFFFFF sentinel is UNKNOWN; guarded in source; matching runtime ABI unverified |
| EdsRelease | void* | UInt32(BaseRef) p40 | Refcount incl valid zero; sentinel/exception is UNKNOWN and ref is retained in bounded quarantine; matching runtime ABI unverified |
| EdsGetPropertySize | void*, uint32, int32, out uint32*, out uint32* | BaseRef, PropertyID, Int32, DataType*, UInt32* p50 | 32-bit enum width justified for H1; output bound262144; actual H1 size calls: 22 zero and 4 recorded nonzero |
| EdsGetPropertyData | void*, uint32, int32, uint32, void* | BaseRef, PropertyID, Int32, UInt32, Void* p51 | Caller buffer; R widths, data format U |
| EdsSetPropertyData | void*, uint32, int32, uint32, void* | BaseRef, PropertyID, Int32, UInt32, const Void* p54 | Caller input remains live for sync call; R |
| EdsGetPropertyDesc | void*, uint32, out PropDesc* | BaseRef, PropertyID, PropertyDesc* p55 | Caller struct; targeted H1 PropDesc layout justified; actual H1 descriptor calls returned 0 |
| EdsSendCommand | void*, uint32, int32 | CameraRef, UInt32, UInt32 p47 | Signedness differs; same bits for used positive constants; U header |
| EdsSetCapacity | void*, Capacity by value | CameraRef, Capacity p50 | U by-value layout |
| EdsGetEvent | none | EdsError() p81 | Console event pump; source timer, native thread effect U |
| EdsSetObjectEventHandler | void*, uint32, ObjectEvent*, void* | CameraRef, ObjectEvent, callback*, Void* p75 | Registered callback retained until unregistered/quiescent; U lifetime |
| EdsSetPropertyEventHandler | void*, uint32, PropertyEvent*, void* | CameraRef, PropertyEvent, callback*, Void* p77 | Same; exact callback macro U |
| EdsSetCameraStateEventHandler | void*, uint32, StateEvent*, void* | CameraRef, StateEvent, callback*, Void* p78 | Same |
| EdsGetDirectoryItemInfo | void*, out DirInfo* | DirectoryItemRef, DirectoryItemInfo* p45 | Caller DirInfo struct; outside targeted H1 qualification |
| EdsCreateMemoryStream | uint64, out void** | UInt64, StreamRef* p66 | Owned stream; release after copy; R |
| EdsDownload | void*, uint64, void* | DirectoryItemRef, UInt64, StreamRef p61 | Transfers into owned stream; Complete/Cancel required; R |
| EdsDownloadComplete | void* | DirectoryItemRef p61 | Camera ACK, not disk durability; R shape |
| EdsDownloadCancel | void* | DirectoryItemRef p62 | Cancel path, not a second Complete; R shape |
| EdsGetPointer | void*, out void** | StreamRef, Void** p67 | Borrowed stream buffer; may move after resize; R |
| EdsGetLength | void*, out uint64* | StreamRef, UInt64* p70 | No JS unsafe-number promise; lengths capped before copy; R |
| EdsSeek | void*, int64, uint32 | StreamRef, Int64, SeekOrigin p69 | Enum width/constants U |
| EdsGetPosition | void*, out uint64* | StreamRef, UInt64* p70 | Position output; R |
| EdsCreateEvfImageRef | void*, out void** | StreamRef, EvfImageRef* p63 | Owned image ref; release before stream; R |
| EdsDownloadEvfImage | void*, void* | CameraRef, EvfImageRef p63 | Source distinguishes temporary NOTREADY; R |
| EdsGetVolumeInfo | void*, out VolumeInfo* | VolumeRef, VolumeInfo* p44 | Optional export; U struct |

`EdsGetPropertyDescEx` and `EdsSetFramePoint` are export-only probes, never invoked. The temporary zero-argument declaration used for probing is NOT a usable binding for those APIs.

## Structs, callbacks and x64

| Source struct | Fields | Source-only default x64 arithmetic | Remaining qualification |
|---|---|---|---|
| DeviceInfo | char[256]×2, uint32×2 | size520/alignment4 | Targeted declarations/probe plus actual H1 read observations |
| PropDesc | int32×3, int32[128] | size524/alignment4 | Targeted declarations/probe plus actual H1 read observations |
| DirInfo | uint64, int32, uint32×2, char[256], uint32×2 | size288/alignment8 | EdsBool, EDS_MAX_NAME, tail padding |
| Capacity | int32×3 | size12/alignment4 | Canon by-value definition |
| VolumeInfo | uint32×2, uint64×2, char[256] | size280/alignment8 | EdsAccess, string bound, pack |

Pointers intended8 bytes; UInt64/Int64 retain 64-bit binding types. DeviceInfo/PropDesc also have the compile-only evidence linked above. The other sizes remain source arithmetic; no general binary-layout proof is claimed.

Object callback: uint32(uint32,void*,void*); Property: uint32(uint32,uint32,uint32,void*); State: uint32(uint32,uint32,void*), all source __stdcall. Public typedefs §3.1.47–49 have these argument shapes. §2.8 ties callbacks to session-opening thread; sample1 releases event objects. Source retains before deferred work, releases callback ref, then deferred ref; successful-path correspondence only. Native post-unregister callbacks/threading/quiescence remain U. Archived convention declarations and Windows x64 rules justify the physical calling boundary; native callback lifetime remains unverified.

Public p191 FocusPoint differs from legacy parser (28-byte public fields vs source32-byte points including selected). Classify SDK-version/documentation ambiguity, not demonstrated installed-runtime bug. Do not replace parser using unmatched reference.

## Result classes and fixes

- Canon EdsError, UInt32 refcount, Win32 BOOL, HRESULT and void are separate result classes.
- Public p40 specifies refcount error sentinel0xFFFFFFFF. Production source now distinguishes reference counts from EdsError results: zero is a valid count; the sentinel or a thrown binding call becomes UNKNOWN; failed retain does not schedule a transfer; an unacknowledged release keeps the opaque ref in bounded quarantine and blocks further native work. Focused source tests live in tests/native-production/h1-readonly.test.cjs. This removes the known source-handling defect, but does not verify the deployed Canon runtime ABI, the live camera's reference behavior, or object lifetime. Actual H1 recorded six zero releases and a normal session close, while its separate aggregate module-location UNKNOWN remains preserved; H3 transfer ownership still needs real-device qualification.
- H1 diagnostics deliberately skip EdsGetVolumeInfo because the source VolumeInfo layout remains U; no optional volume binding is invoked until its layout is reliably qualified. DeviceInfo and PropDesc now have targeted technical qualification and limited actual H1 read observations; that does not qualify other structures or mutating functions.
- Public p31's one init/terminate pair conflicts with potential same-worker recheck/fallback. Matching-runtime lifecycle review is required; N2 instead makes one process/candidate/attempt.
- Confirmed non-Canon fix: SetDllDirectoryW is 32-bit BOOL. Source now binds int32 and converts nonzero to boolean, preserving telemetry. New N2 Win32 BOOL bindings likewise use int32.
- native-buffer uses owned V8 memory copied by msvcrt memcpy before SDK stream release. N2 did not exercise copying or transfers; that boundary remains outside the H1A result. No addon executed in the historical N1 review.

## Transfer/data boundary

Production: Download → Complete → pointer/length → copy → NEW file write → photo event → main registration acknowledgement. §3.1.26–28 supports immediate completion/cancel notification; no ACK reordering. Neither SDK success nor file close proves durable storage. DATA-005 remains OPEN; controlled H3 fault case must separately observe write/close/flush/registration/ACK. Neither source review nor lifecycle/count success proves vendor quiescence or guaranteed capture attribution.

## Historical N1.5 preparation — superseded by recorded N2 execution

The refreshed candidate is PSE 1.33.10.0 / x64 EDSDK.dll 3.18.40.0 / SHA-256 35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627. The version and size match the historical N1 PSE DLL but its hash differs. A trusted old binary was unavailable, so the change cannot be attributed to code or signing.

The candidate exports EdsInitializeSDK and EdsTerminateSDK. Public Canon API Reference 13.20.11 §3.1.1–2 (p.39) gives parameterless EdsError lifecycle signatures; §2.9 and sample1 (pp.193–194) support one init/terminate pair per process and termination only after successful initialization. This supports the documented lifecycle subset for the two functions only. Canon has not mapped this public reference to the current PSE binary. Matching headers and package provenance remain unavailable. Public documentation plus PE exports is static evidence, not proof that invoking this exact PSE implementation is compatible or safe.

N2 does not use structures, references, callbacks or camera operations. FocusInfo, Retain/Release, SendCommand, transfer ACK, DATA-005, H1–H3 and full-runtime ABI questions remain outside this narrow subset and are not resolved here.

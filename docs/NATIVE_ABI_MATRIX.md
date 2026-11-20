# Native ABI matrix — N1

Source: `electron/camera-worker.cjs`, `native-buffer.cjs`, `transfer-producer.cjs`, `native-observations.cjs`. Reference: official public Canon API Programming Reference **13.20.11**, SHA `71c3686452af13e66ffe7bc95e40f84264d7a368288d5231ccd6999fe27bdc2b`, [Canon-linked PDF](https://canon-industrial-imaging-production.fra1.digitaloceanspaces.com/wp-content/canon_b2b/uploads/2026/09/15132330/EDSDK_API_EN-4.pdf).

31 mandatory bindings and one optional EdsGetVolumeInfo use `__stdcall`; return `uint32`. Except Retain/Release these represent EdsError (zero success, raw nonzero error retained, taxonomy/version still unverified). R below means reference shape compatible, **not matching runtime ABI**. U means header/packing/version evidence required. Vendor opaque refs are pointers; output ref needs pointer-to-pointer. No Koffi native sizeof or DLL calls performed.

## Functions

| Symbol | Existing Koffi arguments | Reference prototype shape / page | Ownership / result / status |
|---|---|---|---|
| EdsInitializeSDK | none | EdsError() p39 | Once/process in public ref; R; matching lifecycle U |
| EdsTerminateSDK | none | EdsError() p39 | Releases SDK resources; after successful init; R |
| EdsGetCameraList | out void** | CameraListRef* p42 | Implicit owned ref; release; R |
| EdsGetChildCount | void*, out uint32* | BaseRef, UInt32* p41 | Count output, not ref; R |
| EdsGetChildAtIndex | void*, int32, out void** | BaseRef, Int32, BaseRef* p41 | Implicit owned child ref; R |
| EdsGetDeviceInfo | void*, out DeviceInfo* | CameraRef, DeviceInfo* p43 | Caller struct buffer; U layout |
| EdsOpenSession | void* | CameraRef p46 | Session lifetime on camera ref; R |
| EdsCloseSession | void* | CameraRef p46 | Close before ref release; R, quiescence U |
| EdsRetain | void* | UInt32(BaseRef) p40 | Refcount, not EdsError; 0xFFFFFFFF error sentinel; R type |
| EdsRelease | void* | UInt32(BaseRef) p40 | Refcount incl valid zero, sentinel error; R type |
| EdsGetPropertySize | void*, uint32, int32, out uint32*, out uint32* | BaseRef, PropertyID, Int32, DataType*, UInt32* p50 | Enum underlying width U; output size bounds source262144 |
| EdsGetPropertyData | void*, uint32, int32, uint32, void* | BaseRef, PropertyID, Int32, UInt32, Void* p51 | Caller buffer; R widths, data format U |
| EdsSetPropertyData | void*, uint32, int32, uint32, void* | BaseRef, PropertyID, Int32, UInt32, const Void* p54 | Caller input remains live for sync call; R |
| EdsGetPropertyDesc | void*, uint32, out PropDesc* | BaseRef, PropertyID, PropertyDesc* p55 | Caller struct; U layout |
| EdsSendCommand | void*, uint32, int32 | CameraRef, UInt32, UInt32 p47 | Signedness differs; same bits for used positive constants; U header |
| EdsSetCapacity | void*, Capacity by value | CameraRef, Capacity p50 | U by-value layout |
| EdsGetEvent | none | EdsError() p81 | Console event pump; source timer, native thread effect U |
| EdsSetObjectEventHandler | void*, uint32, ObjectEvent*, void* | CameraRef, ObjectEvent, callback*, Void* p75 | Registered callback retained until unregistered/quiescent; U lifetime |
| EdsSetPropertyEventHandler | void*, uint32, PropertyEvent*, void* | CameraRef, PropertyEvent, callback*, Void* p77 | Same; exact callback macro U |
| EdsSetCameraStateEventHandler | void*, uint32, StateEvent*, void* | CameraRef, StateEvent, callback*, Void* p78 | Same |
| EdsGetDirectoryItemInfo | void*, out DirInfo* | DirectoryItemRef, DirectoryItemInfo* p45 | Caller struct; U layout |
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

| Source struct | Fields | Source-only default x64 arithmetic | Remaining header gate |
|---|---|---|---|
| DeviceInfo | char[256]×2, uint32×2 | size520/alignment4 | Reserved field, char length, pack |
| PropDesc | int32×3, int32[128] | size524/alignment4 | EdsAccess width, pack |
| DirInfo | uint64, int32, uint32×2, char[256], uint32×2 | size288/alignment8 | EdsBool, EDS_MAX_NAME, tail padding |
| Capacity | int32×3 | size12/alignment4 | Canon by-value definition |
| VolumeInfo | uint32×2, uint64×2, char[256] | size280/alignment8 | EdsAccess, string bound, pack |

Pointers intended8 bytes; UInt64/Int64 retain 64-bit binding types. These sizes are arithmetic from source, not header/Koffi execution proof.

Object callback: uint32(uint32,void*,void*); Property: uint32(uint32,uint32,uint32,void*); State: uint32(uint32,uint32,void*), all source __stdcall. Public typedefs §3.1.47–49 have these argument shapes. §2.8 ties callbacks to session-opening thread; sample1 releases event objects. Source retains before deferred work, releases callback ref, then deferred ref; successful-path correspondence only. Native post-unregister callbacks/threading/quiescence remain U. Exact EDSAPI/EDSCALLBACK macros require headers.

Public p191 FocusPoint differs from legacy parser (28-byte public fields vs source32-byte points including selected). Classify SDK-version/documentation ambiguity, not demonstrated installed-runtime bug. Do not replace parser using unmatched reference.

## Result classes and fixes

- Canon EdsError, UInt32 refcount, Win32 BOOL, HRESULT and void are separate result classes.
- Public p40 specifies refcount error sentinel0xFFFFFFFF. Existing direct releases and transfer-producer ignore it; observation collector currently treats reference numbers as counts. **BLOCKS RELEASE** for camera/reference/transfer ownership safety claims and must be resolved before H1/H3 ownership qualification. This is not a reason to treat every nonzero count as error. Resolve matching-version sentinel policy and add focused tests. The narrow N2 lifecycle child obtains no camera/list/stream refs and does not call Retain/Release.
- Public p31's one init/terminate pair conflicts with potential same-worker recheck/fallback. Matching-runtime lifecycle review is required; N2 instead makes one process/candidate/attempt.
- Confirmed non-Canon fix: SetDllDirectoryW is 32-bit BOOL. Source now binds int32 and converts nonzero to boolean, preserving telemetry. New N2 Win32 BOOL bindings likewise use int32.
- native-buffer uses owned V8 memory copied by msvcrt memcpy before SDK stream release. Its real pointer/ref/ABI safety still needs N2/H gates; no addon executed in N1.

## Transfer/data boundary

Production: Download → Complete → pointer/length → copy → NEW file write → photo event → main registration acknowledgement. §3.1.26–28 supports immediate completion/cancel notification; no ACK reordering. Neither SDK success nor file close proves durable storage. DATA-005 remains OPEN; controlled H3 fault case must separately observe write/close/flush/registration/ACK. Header absence also prevents claiming vendor-backed forced-cleanup or guaranteed capture attribution.

## N1.5 — refreshed runtime and lifecycle-only qualification

The refreshed candidate is PSE 1.33.10.0 / x64 EDSDK.dll 3.18.40.0 / SHA-256 35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627. The version and size match the historical N1 PSE DLL but its hash differs. A trusted old binary was unavailable, so the change cannot be attributed to code or signing.

The candidate exports EdsInitializeSDK and EdsTerminateSDK. Public Canon API Reference 13.20.11 §3.1.1–2 (p.39) gives parameterless EdsError lifecycle signatures; §2.9 and sample1 (pp.193–194) support one init/terminate pair per process and termination only after successful initialization. This supports the documented lifecycle subset for the two functions only. Canon has not mapped this public reference to the current PSE binary. Matching headers and package provenance remain unavailable. Public documentation plus PE exports is static evidence, not proof that invoking this exact PSE implementation is compatible or safe.

N2 does not use structures, references, callbacks or camera operations. FocusInfo, Retain/Release, SendCommand, transfer ACK, DATA-005, H1–H3 and full-runtime ABI questions remain outside this narrow subset and are not resolved here.

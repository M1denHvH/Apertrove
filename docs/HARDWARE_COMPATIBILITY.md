# Canon hardware compatibility evidence

Recorded **21 November 2026** for one installed runtime and one camera environment. These results do not certify all Canon EOS cameras, PSE releases or camera functions.

## Identities

| Component | Recorded identity |
|---|---|
| Camera environment | Canon EOS 2000D over USB, identified by the actual H1 device-info/property reads after H1A counted one camera. |
| Firmware | `1.3.0`, read through the SDK. |
| Lens | User-reported Sigma 17–70mm f/2.8–4 OS HSM; SDK string `17-70mm F2.8-4 DC MACRO OS HSM \| Contemporary 013`. H2 AF/near/far commands were accepted; optical focus and physical movement were not measured. |
| Canon runtime | User-installed Picture Style Editor x64; EDSDK.dll file/product version 3.18.40.0, 1,522,576 bytes; Canon signature Valid at preflight. |
| Runtime SHA-256 | `35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627` |
| Koffi | 2.16.3, Windows x64 addon SHA-256 `1305fdf18bcb5e71c1cd0530cd0834b9858beb01606f58086e587343809bfa3b` |
| H1A source | `6e2539f9428aeab738175c888d16781aa6296b8e`; integration cherry-pick `eb937a8e17c1a5708a759d2aa5eb63c6b30ef747`. |
| Blocked H1 launcher source | `e532e041da9939d185b9c3e76f8b24bee67393ef`; integration cherry-pick `290b688cae1669b1d769d5c83bf66df20cc520a9`. |
| Authorized real H1 source | `a49268e0bab6c3e792c5a3adfad6b7d8ee49dbd6`, after the isolated-path/synchronous-gate correction. |

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
| First H1 launcher attempt | BLOCKED before SDK | Electron exited 2147483651 (0x80000003) before Job assignment/grant. No native worker or camera report; no recorded run processes remained. This historical attempt is preserved separately. |
| Separately authorized H1 retry | **Raw runner result: UNKNOWN** | Actual camera reads and normal cleanup completed. The final aggregate classification was UNKNOWN because the module-location filter rejected five GPU-driver DLL paths; see review below. The raw result is not rewritten as PASS. |
| H1: EdsInitializeSDK / EdsOpenSession / EdsCloseSession / EdsTerminateSDK | `0` each, once | Actual main/preload/renderer and production camera worker; one read-only camera session. |
| H1: EdsGetDeviceInfo / EdsGetPropertyData / EdsGetPropertyDesc | All `0`; 3 / 52 / 22 calls | Recorded identity, current properties and descriptors for this camera/mode/runtime. No setting writes were tested. |
| H1: EdsGetPropertySize | 22 zero, 4 nonzero | Focal length `0x409` returned `0x50` twice; EVF Zoom `0x507` and Zoom Position `0x508` returned `0x7` once each. No property-data call followed a failed size read. These observations do not establish permanent feature support in other camera states. |
| H1: EdsRelease and cleanup | Six releases returned `0` | Acquired refs balanced, three local callback trampolines released, DLL unload and COM balance recorded. Camera worker and Electron root exited naturally with code 0; Job accounted eight processes and ended with zero active processes/closed handle. Independent post-check found none of nine recorded PIDs live. |
| First FULL H2 | **Raw UNKNOWN retained** | ISO/Tv/Av targets and restoration confirmed; Live View 1056×704, about 27.5 FPS, software histogram ON/OFF. Stopped before AF on a cached post-stop baseline; no fresh AF/metering reading existed for that receipt. |
| Separately authorized FOCUS_ONLY H2 | **H2_CONTROLLED_SERIES_RECORDED** | Four AF/near/far commands returned zero; AF remained unverified. Eighteen recorded raw scalars matched, with fresh ordered post-restore proof for 11 critical properties. [Exact sources, measurements and limits](H2_VALIDATION.md). |
| H3: shutter, RAW/JPEG, transfers and fault cases | NOT RUN | Requires separate approval and fresh isolated test photos. DATA-005 is OPEN. |

H1A opened no camera session. The authorized H1 retry remained `working:false`, `eventsRegistered:false`, `live:false`, `saveTo:null`, then reported disconnected. Its trace contains no property write, SaveTo/Capacity change, Canon callback registration, EVF/AF/shutter/download/cancel or camera-file operation. No original was used or modified by this read-only route. A full independent camera-state comparison is not claimed.

## H1 read-only report

| Read value | Observed result |
|---|---|
| Battery / shooting mode | 80% / M |
| ISO | 400; raw value 88 (`0x58`); 9 descriptor choices |
| Aperture | f/22; raw value 80 (`0x50`); 18 descriptor choices |
| Shutter | 1/320 s; raw value 123 (`0x7b`); 53 descriptor choices |
| White balance | Auto; raw value 0; 9 descriptor choices |
| Other descriptor observations | JPEG L Fine, 10 image-quality choices; drive mode Continuous, 5 choices; metering Partial, 3; Picture Style Auto, 10; AF mode AI Focus and Live View AF method Quick, 3 choices each. These are reads, not executed functions. |
| Temporarily unavailable / untested | Exposure compensation had no writable choices in M; Kelvin was not queried outside color-temperature WB mode. Card traversal, volume details, transfer events, EVF frames, shutter and focus operations were not tested. A returned FocusInfo block does not qualify its legacy point parser or AF accuracy. |

The module-location finding consisted only of `nvldumdx.dll`, `nvgpucomp64.dll`, `NvMemMapStoragex.dll`, `nvwgf2umx.dll` and `nvppex.dll` in the Electron GPU process under Windows System32/DriverStore. The original filter admitted files directly inside System32, so it rejected these subdirectory paths. Post-run inspection recorded a Valid signature from Microsoft Windows Hardware Compatibility Publisher for all five; four also reported NVIDIA company/version metadata, while one had no such version resource. This explains the observed location finding, not a new SDK error. Original paths, hashes, raw UNKNOWN result and the separate review remain preserved privately. No policy was relaxed and no native rerun was made to obtain PASS.

Periodic N2/H1A module samples saw Node, Koffi and Windows modules but missed Canon's short DLL lifetime; they are not complete dynamic dependency inventories. A nonfatal stdout-sync diagnostic was retained in raw logs. SDK returns and confirmed cleanup are separate from that diagnostic. Raw logs, manifests, USB identifiers and private paths remain outside Git.

## Remaining work

The [targeted ABI evidence](HARDWARE_ABI_QUALIFICATION.md) has limited actual observations on this EOS 2000D. It does not qualify every structure/function or other bodies/lenses. Preserve the historical H1/H2 UNKNOWN receipts and their separate reviews. [H2_VALIDATION.md](H2_VALIDATION.md) records the exposure/Live View scope and separately authorized focus continuation, including fresh restoration and cleanup. H3 remains NOT RUN; no repeat or additional hardware operation is automatic.

DATA-005 is the existing Download → Complete → memory copy → file write → registration gap in baseline main. SDK completion and ordinary file/JSON close do not prove durable host storage; H2 did not change that ordering. Capture/H3 and release qualification remain open. This baseline issue is not an automatic ban on an independently verified controls/read-only/UI merge; final scope, exact checks, CI, review and user merge confirmation remain required. Apertrove distributes no proprietary Canon DLL/header; this fact alone does not establish use rights.

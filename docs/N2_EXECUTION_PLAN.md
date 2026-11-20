# N2 execution plan — one real Canon lifecycle cycle

**NOT EXECUTED / NOT AUTHORIZED in N1.** One dedicated Windows x64 Node process, one explicit DLL, one init, conditional terminate, no retries. No Electron UI, application camera-worker import, camera enumeration/session/properties/AF/EVF/capture/WIA/flash/card operations.

## Prerequisites before any native load

1. Obtain licensed matching headers/reference/release notes and runtime mapping through Canon. Installed EOS Utility EDSDK files are x86; do not load into x64. Supply compatible EOS Utility x64 or explicitly authorize a qualified alternate. PSE3.18.40.0 is only a dry-run example, no automatic fallback.
2. Review exact no-argument lifecycle prototypes, uint32 EdsError, Windows x64 calling convention, successful-init conditional terminate (public13.20.11 p39/sample1), and no reinit. Document version identity or supported narrow lifecycle subset; do not equate export names with ABI.
3. Review exact Koffi2.16.3 win32_x64 addon hash/source/import dependencies and Node executable hash. This N1 does not authorize its execution.
4. Complete dependency and initialization-effects review. Static import list is not complete dynamic closure; record Windows version, Canon processes/services and before/after OS process/handle/module observations. Initialization/DllMain may access devices/services or start native threads even without enumeration. Obtain explicit consent for these effects.
5. Physically disconnect all camera USB/network connections; close EOS Utility/tray ownership. Operator confirms physical condition; no software boolean proves it. Keep genuine photos/user profiles outside fixture paths.
6. Review pristine harness sources and manifest hashes. Every DLL sibling in selected runtime directory is pinned; any added/changed DLL blocks admission. No install-tree writes, no proprietary Git files, no global PATH/registry changes.

## Entrypoints and manifest

- `tests/native-n1/prepare.cjs`: built-in-only manifest preparation, always UNKNOWN/unreviewed, unique ignored output.
- `manifest.cjs`: x64 PE/export/hash/complete sibling inventory and source identity checks; no native imports.
- `run.cjs`: addon-free parent, dry-run or explicit execute gate, disposable output, external watchdog.
- `worker.cjs`: exact addon path (no package loader fallback), local-only DLL search restriction, exact LoadLibraryExW(System32|DLL_LOAD_DIR), GetProcAddress for only Init/Terminate and Koffi function-pointer calls. Successful cycle releases the library/COM/search cookie; uncertainty retains dependencies until process exit.
- `check.cjs`: source-only regression/parser/admission tests; synthetic fixtures never treated as native results.

Prepare from explicit absolute paths (PowerShell variables set by operator, no auto resolution):

```powershell
$env:NODE_OPTIONS=''; $env:NODE_PATH=''
node --no-addons tests/native-n1/prepare.cjs --runtime $dll --koffi $addon --reference $pdf
node --no-addons --max-old-space-size=192 tests/native-n1/run.cjs --dry-run --manifest $manifest
```

Preparation captures exact runtime/dependency hashes, Node hash, three executable harness-source hashes, addon identity, and reference hash. Generated manifest contains five blocking review decisions by default. A dry-run exit0 means input identities validated, **not** ready/native PASS. `ready:false` and blocker list are expected in N1. Malformed/changed identity returns2.

Reviewers must substantiate manifest fields with evidence before clearing them: vendorReview.status CONFIRMED_MATCH or VERIFIED_LIFECYCLE_SUBSET; initSuccessRequiresTerminate/initFailureMustNotTerminate; dependencyReview REVIEWED; koffi.reviewed; safetyReview.initializationEffectsReviewed. These fields record human engineering approval, not cryptographic vendor proof. Regenerate after source/binary changes; never simply toggle booleans to bypass missing evidence.

## Future command — only after separate explicit authorization

```powershell
node --no-addons --max-old-space-size=192 tests/native-n1/run.cjs --execute --manifest $manifest --authorize-native-n2 --camera-disconnected
```

Parent validates before importing child_process. One hidden native child is launched with heap128, empty preloads, disposable APPDATA/LOCALAPPDATA/TEMP, System32-only PATH and nonce/IPC handshake. Child revalidates all identities before loading. Process-local DLL search settings die with child; global machine settings unchanged. Windows loader/known DLL/API-set internals remain an external validation concern.

External parent watchdog requests termination at15s; at17s unconfirmed exit is recorded processEnded=false/UNKNOWN and parent stops waiting. No retry or next DLL. A forced kill is never clean shutdown. Any init failure, exception, timeout or terminate/unload failure stops the cycle; no attempt to recover by repeated init. Terminate only after successful init; uncertain cleanup is not disguised as success.

Receipt records load attempt (failed DllMain load remains UNKNOWN), raw COM/init/terminate codes, balanced COM/unload observations, PID, code/signal, timeout and process-ended observation. `SOURCE_ZERO_CYCLE` is only source-level return/exit evidence; native-created descendants/OS handles/quiescence are NOT independently proven. Before declaring N2 successful, compare external process/module/handle census and confirm no unexpected Canon/device effects. Keep all logs ignored.

## Stop and rollback

Mismatch/unreviewed manifest: refuse before native. Native crash/timeout/nonzero: preserve result, stop, inspect exact PID and any new Canon descendants with OS tools; do not blindly retry or free uncertain refs. Do not delete camera files or installation components. Child-owned disposable directories remain for evidence. Machine-wide settings require no rollback because none are changed. If effects exceed approved scope, user closes/restarts only the identified process/service after review.

## Later H1/H2/H3 — plans only

| Gate | Executable application path / bounded procedure | Required evidence and stop |
|---|---|---|
| H1 | Separately authorize one connected EOS2000D in a fresh app/worker with no working session. Use existing Find cameras/select actual ID, then main cameraDiagnose → connectCamera(readOnly:true) → diagnoseCamera; finish with cameraEndDiagnostics. Never normal Connect/cameraWorking | No property/capture writes; normal Connect prepares SaveTo/capacity and is excluded. Compare model/firmware/descriptors/report with guards; stop on unknown ref/session cleanup. Refcount contract gap must be resolved first |
| H2 | Separate explicit permissions: existing Live View toggle; one supported ISO/Tv/Av write/readback at a time; AF/lens only with detected support; restore saved settings; card listing/import separately | Snapshot original settings, model+firmware+lens+SDK; bounded counts/durations agreed before run, stop on error/restore failure; no implicit shutter |
| H3 | Separate shutter permission: exactly one supported RAW/JPEG capture into NEW synthetic session folder; SHA originals, transfer→registration; one agreed cancellation/interruption fault separately | Record SDK ACK, memory copy, write/close/flush where applicable, registration ack and camera/card state separately. Retain originals; no repeated shutter or destructive power-loss test |

EOS2000D is first hardware target, not a code restriction. Future compatibility rows record model/firmware/SDK/function/actual gate result; untested models remain NOT RUN. These plans reuse existing application paths and guards; they are not permission to run them now.

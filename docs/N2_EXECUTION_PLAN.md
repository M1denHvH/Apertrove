# N2 execution plan — one real Canon lifecycle cycle

**NOT EXECUTED / NOT AUTHORIZED in N1.5.** One dedicated Windows x64 Node process, one explicit DLL, one init, conditional terminate, no retries. No Electron UI, application camera-worker import, camera enumeration/session/properties/AF/EVF/capture/WIA/flash/card operations.

## Prerequisites before any native load

1. Current preferred candidate for qualification is PSE 1.33.10.0 with EDSDK 3.18.40.0 x64, SHA-256 35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627. This is not yet a verified production runtime. EOS Utility EDSDK candidates found locally are x86.
2. The two-function init/terminate subset was reviewed against public Canon reference 13.20.11 p.39 and sample1 pp.193–194. It does not prove this changed PSE DLL is a matching package. Obtain matching headers or a Canon statement mapping the exact installed runtime to a licensed package before broader ABI claims.
3. Koffi 2.16.3 win32_x64 addon matches the exact official registry tarball selected by package-lock integrity; its direct PE imports are KERNEL32 and ADVAPI32. This review did not execute the addon.
4. Dependency closure and initialization-effects gates remain open. Static import matches do not resolve recursive forwarders, dynamic loads, sibling transitive dependencies, DllMain behavior or side effects. Process/module/handle observation belongs to the separately authorized N2 cycle.
5. Physically disconnect all camera USB/network connections; close EOS Utility and Picture Style Editor processes. Operator confirms physical condition; no software boolean proves it. Keep genuine photos/user profiles outside fixture paths.
6. Review pinned harness sources, including the manifest generator. Every DLL sibling in the selected runtime directory is pinned; any added/changed DLL blocks admission. No install-tree writes, no proprietary Git files, no global PATH/registry changes.

## Entrypoints and manifest

- prepare.cjs: built-in-only manifest preparation, initially unqualified, unique ignored output under qa/native-n2-prep/.
- `manifest.cjs`: x64 PE/export/hash/complete sibling inventory and source identity checks; no native imports.
- run.cjs: addon-free parent, dry-run or explicit execute gate, disposable output, supervised child process.
- `worker.cjs`: exact addon path (no package loader fallback), local-only DLL search restriction, exact LoadLibraryExW(System32|DLL_LOAD_DIR), GetProcAddress for only Init/Terminate and Koffi function-pointer calls. Successful cycle releases the library/COM/search cookie; uncertainty retains dependencies until process exit.
- `check.cjs`: source-only regression/parser/admission tests; synthetic fixtures never treated as native results.

Prepare from explicit absolute paths (PowerShell variables set by operator, no auto resolution):

```powershell
$env:NODE_OPTIONS=''; $env:NODE_PATH=''
node --no-addons tests/native-n1/prepare.cjs --runtime $dll --koffi $addon --reference $pdf
node --no-addons --max-old-space-size=192 tests/native-n1/run.cjs --dry-run --manifest $manifest
```

Preparation captures exact runtime/dependency hashes, Node hash, four executable harness-source hashes, addon identity, and reference hash. Generated manifest contains five blocking review decisions by default. A dry-run exit0 means input identities validated, **not** ready/native PASS. `ready:false` and blocker list are expected until the exact N2 admission evidence supports a limited gate review. Malformed/changed identity returns2.

Reviewers must substantiate manifest fields with evidence before clearing them: vendorReview.status CONFIRMED_MATCH or VERIFIED_LIFECYCLE_SUBSET; initSuccessRequiresTerminate/initFailureMustNotTerminate; dependencyReview REVIEWED; koffi.reviewed; safetyReview.initializationEffectsReviewed. These fields record human engineering approval, not cryptographic vendor proof. Regenerate after source/binary changes; never simply toggle booleans to bypass missing evidence.

## Future command — only after separate explicit authorization

```powershell
node --no-addons --max-old-space-size=192 tests/native-n1/run.cjs --execute --manifest $manifest --authorize-native-n2 --camera-disconnected
```

Parent validates before importing child_process. One hidden native child is launched with heap128, empty preloads, disposable APPDATA/LOCALAPPDATA/TEMP, System32-only PATH and nonce/IPC handshake. Child revalidates all identities before loading. Process-local DLL search settings die with child; global machine settings unchanged. Windows loader/known DLL/API-set internals remain an external validation concern.

The parent watchdog requests termination at 15s and retains child-process supervision until Windows confirms close. It never detaches or reports an unconfirmed process as ended. If close is not confirmed, the parent waits without a final time bound and no successful receipt is produced; a stuck child can leave the runner waiting indefinitely. A forced kill is never clean shutdown. Any init failure, exception, timeout or terminate/unload failure stops the cycle; no attempt to recover by repeated init. Terminate only after successful init; uncertain cleanup is not disguised as success.

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

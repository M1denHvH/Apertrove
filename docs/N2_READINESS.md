# N2 readiness — N1.5

Status: PARTIAL. The refreshed PSE runtime is a statically inspected x64 candidate. No Canon DLL or Koffi addon was loaded, and the real N2 cycle was not authorized or run.

## Updated PSE identity

PSEditor.exe at C:\Program Files\Canon\Picture Style Editor\PSEditor.exe is version 1.33.10.0, x64, Canon Authenticode Valid, SHA-256 b4f3f47b24a2b90ac43fb7491d65c98cc2ddb305a83018297c2c19bfdb5fead1. Its EDSDK.dll at C:\Program Files\Canon\Picture Style Editor\EDSDK.dll is x64, FileVersion/ProductVersion 3.18.40.0, 1,522,576 bytes, Canon Authenticode Valid, SHA-256 35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627.

The old N1 EDSDK hash dbebe8a3d415414a4accf822027165fbbf947f25bb6ba68ebbaa1ec0a0fbc019 has not been found in the inspected Canon install roots. Current file has same version and size but different bytes. We cannot attribute the difference to implementation change or signing-only change. The fresh inventory is qa/native-n2-prep/runtime-pse-inventory.json and is git-ignored. EDSDK exports are 129 names and ordinals, with all 31 production worker names and both lifecycle names. Direct imports matched 198 imported symbols to eight x64 System32 export candidates; all direct candidates/signatures were checked. Dynamic loads, recursive forwarders/API sets, sibling transitive closure, DllMain and initializer side effects remain unknown.

## Official SDK and ABI boundary

Canon EDSDK reference 13.20.11 was retrieved from a Canon-linked public source in N1. Its p.39 and sample1 pp.193–194 support parameterless init/terminate, a process-level pair, and terminating only after successful initialization. The manual does not establish that this PSE DLL is the matching build. Canon release history links API releases to dates and capabilities but does not publish this installed file hash mapping. Matching public headers, exact Canon runtime mapping and a usable package license were not obtained.

Canon public references: the official [PSE download page](https://asia.canon/en/support/0200774903), [EDSDK release notes](https://asia.canon/en/campaign/developerresources/camera/cap/edsdk-eos-digital-camera-sdk-release-note), and [Canon Europe Developer Portal](https://developers.canon-europe.com/developers/s/login/). The Asia EDSDK catalogue and reference do not publish a mapping from this installed DLL hash to a header package.

PSE application version, DLL FileVersion and SDK package version are distinct. The number 3.18.40.0 alone is not proof of a Canon EDSDK package match. The Canon Asia PSE product-download page states regional personal/non-commercial terms and restrictions on redistribution and reverse engineering for that download. These regional PSE terms are not an EDSDK package license and should not be generalized to other regions. Do not ship Canon binaries or present PSE installation as a redistribution license. Official sources: Canon's [PSE 1.33.10 download page](https://asia.canon/en/support/0200774903), [EDSDK release notes](https://asia.canon/en/campaign/developerresources/camera/cap/edsdk-eos-digital-camera-sdk-release-note), and [Europe Developer Portal](https://developers.canon-europe.com/developers/s/login/). The official Asia SDK page lists SDK package versions, but does not map the installed DLL hash. After signing in personally, obtain the official Windows SDK headers, license/readme and release notes or request written mapping for the exact PSE-shipped DLL. No account, credentials or legal terms were handled here.

Narrow lifecycle assessment: the existing child binds only EdsInitializeSDK and EdsTerminateSDK, with no structures, object references, callbacks or camera calls. The reviewed reference and candidate exports justify preparing a lifecycle-subset review; they do not justify full runtime ABI, model coverage or hardware claims. The fresh manifest records the vendor decision as VERIFIED_LIFECYCLE_SUBSET and the conditional terminate ordering as reviewed, limited to the documented public API contract plus the two export names. This is not Canon confirmation that reference 13.20.11 matches the installed DLL. The exact runtime/version correspondence remains unresolved.

The official Developer Portal requires personal account access for the SDK package. Use the appropriate regional registration and verify eligibility. No sign-in or form submission was attempted.

## Admission gates

| Gate | N1.5 evidence and disposition |
| --- | --- |
| Canon lifecycle subset | Scoped to PSE file identity plus public lifecycle contract and the two required export names. Not a full package-to-binary mapping or full ABI proof. |
| Lifecycle order | The runner makes one init attempt, calls terminate only after init returns zero, and does not retry or change DLL. Reviewed subset only. |
| Dependency closure | BLOCKED. Immediate static imports resolve to reviewed x64 Windows candidates. Recursive OS forwarders/API sets, dynamic loads and all initialization-time effects are not closed. |
| Native addon review | Statically reviewed. package-lock integrity matches the official registry tarball SHA-512, and the local x64 Koffi addon exactly matches its tarball member. Direct imports are KERNEL32.dll and ADVAPI32.dll. It has not been executed. |
| Initialization effects | BLOCKED. DllMain and SDK initialization may load dynamic modules, start threads, or access services/devices. Requires the separately authorized isolated N2 run and before/after observation. |

The first two manifest decisions are scoped to the documented lifecycle subset. The static Koffi package identity review supports its addon evidence field. Dependency and effects blockers remain. Fresh manifest qa/native-n2-prep/n2-manifest-893305f0-5361-42b4-8f52-7e48caaed588.json has SHA-256 838dfb9e0b33855277747fbb3542cf0a442b2903d75a4ce71950e82ea00355ed. Its addon-free dry-run exited 0 with ready false, nativeLoaded false and blockers DEPENDENCY_CLOSURE_REVIEW_REQUIRED and INITIALIZATION_EFFECTS_REVIEW_REQUIRED.

## Harness and resolver

Existing N1 harness is retained. prepare.cjs hash is now pinned alongside manifest.cjs, run.cjs and worker.cjs. The generator and native-run artifacts write under ignored qa/native-n2-prep/. The 15-second watchdog asks Windows to terminate the exact child and retains supervision until confirmed process close. If close is not confirmed, the parent waits without a final time bound and reports no completion. This prevents an unconfirmed child from being detached, but a stuck child can leave the runner waiting indefinitely. There is no Windows Job Object supervising the parent against its own unexpected termination. Source-only tests check for removal of the early-detach branch. No native child is started by preparation or dry-run.

The production sdkCandidates sequence checks Program Files EOS Utility roots, then Program Files Picture Style Editor, Webcam and Network Tool. Current installation has no x64 EOS Utility candidate in those roots, and installed x86 EOS Utility copies are rejected by architecture in the x64 process. PSE is therefore the first currently present standard x64 candidate in that order. No resolver code change is justified before runtime qualification.

There is a separate production-worker lifecycle blocker. camera-worker.load() can continue to another candidate after an initialization error, and sdkEnvironment({recheck:true}) can terminate and initialize again in the same worker. Canon's public reference documents one init/terminate pair per process. N1.5 leaves production unchanged because the installed runtime is not mapped to that reference and this task is limited to N2 preparation. Before a PSE-first production resolver or user-facing requirement, ensure retries and rechecks cannot initialize a different runtime again in the same process; a fresh worker attempt may be appropriate after review. After N2 proof, the minimal policy change to consider is moving the standard PSE root immediately ahead of EOS Utility roots while retaining explicit user selection and EDSDK_DIR precedence, architecture checks, exact-directory loading restrictions and existing alternatives. Validate candidate choice from installation metadata only; do not select by version-number similarity.

## Deferred user documentation migration

Do not yet claim that installing PSE is a verified or sufficient Apertrove requirement. Affected user-facing text is localized: README.md and README.ru.md step 3 recommend EOS Utility or Canon developer components; docs/INSTALLATION.md section 3 does the same; docs/REQUIREMENTS.md says EOS Utility may provide a suitable local DLL. The setup UI uses onboarding.install_eos_utility_for_your_camera_or_select in en-US.json and ru-RU.json and has the onboarding.download_eos_utility link label in both locales. docs/TROUBLESHOOTING.md directs users to official Canon software for missing EDSDK. Its EOS Utility close/busy guidance remains useful for camera contention and should stay. Keep those historical instructions until N2 qualification and a validated resolver policy exist.

After those conditions, synchronize English and Russian README, installation, requirements, troubleshooting and setup onboarding. Proposed factual text:

English: “For camera control, install a Canon-supported x64 EDSDK package. Apertrove checks installed Canon runtimes and reports their architecture and version. Picture Style Editor may provide a compatible runtime on supported installations; available camera features depend on the camera and SDK. Obtain Canon software from Canon. Do not download or copy standalone DLLs from unofficial sources.”

Russian: “Для управления камерой установите поддерживаемый Canon пакет EDSDK x64. Apertrove проверяет установленные компоненты Canon и сообщает их архитектуру и версию. В некоторых поддерживаемых конфигурациях совместимая библиотека может входить в Picture Style Editor; набор функций зависит от камеры и SDK. Загружайте ПО с сайта Canon. Не используйте отдельные DLL с неофициальных сайтов и не копируйте их в системные папки.”

Keep EOS Utility as a known alternative when its installed DLL architecture is compatible. Do not promise every PSE release includes the same runtime. Defer the public migration until the PSE lifecycle candidate is qualified, the worker's same-process recheck/retry path is resolved, the resolver policy is validated and target-camera H1 evidence supports the setup claim. Canon proprietary libraries remain separately obtained and are never bundled without redistribution rights.

Onboarding diagnostics should separate: missing DLL; wrong architecture (show candidate path/architecture); missing or failed dependency (show load error and candidate folder); unsupported SDK version only when a verified version policy exists; camera not detected after successful SDK initialization; camera feature unsupported only after capability probing; native initialization failure with raw Canon code. Current loader uses broad missing-or-load-failure text and does not enforce a verified SDK-version allowlist. Implement these categories after the runtime qualification, not by guessing from arbitrary Windows load-error strings.

## Required safety checks before a future native N2 cycle

1. Complete dependency review for this exact PSE directory and record any remaining dynamic-load boundary. Immediate import matching alone is insufficient.
2. Review the bounded initialization-effects plan and record the baseline Windows processes/modules/handles. Ensure no camera, EOS Utility or PSE process is active before a future cycle.
3. Verify that the relevant regional Canon terms permit the intended use. If this is unclear, request Canon confirmation. Do not accept terms on the user's behalf.
4. After checks 1–3, obtain separate explicit authorization for exactly one N2 cycle. Generate a fresh manifest after any source/evidence change and confirm only the justified dry-run blockers.

Future command after those conditions and separate explicit authorization only:

node --no-addons --max-old-space-size=192 tests/native-n1/run.cjs --execute --manifest $manifest --authorize-native-n2 --camera-disconnected

No N2, H1, H2 or H3 execution was authorized or performed in N1.5.

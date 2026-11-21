# N2 — one-attempt lifecycle protocol

**Recorded result, 21 November 2026: SOURCE_ZERO_CYCLE, exit 0. N2 is complete.** One separately installed PSE x64 runtime completed EdsInitializeSDK()=0 and EdsTerminateSDK()=0, reported DLL unload and balanced COM, and exited naturally with an empty supervised Job tree. No camera was connected. Do not repeat N2 merely to obtain another PASS.

The tested EDSDK.dll file version was 3.18.40.0, SHA-256 `35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627`. This is a lifecycle result for those bytes, not certification of every PSE release or any camera operation. Periodic samples saw Node, Koffi and Windows modules; the brief Canon DLL lifetime was not captured, so no complete dynamic dependency closure is claimed. A nonfatal `Failed to sync '<stdout>'` diagnostic was preserved with the raw logs; its origin was not established. SDK returns and process cleanup were successful.

The local manifest, raw observations and supervisor logs stay in ignored QA storage. Public documentation contains no user paths, camera identifiers or experiment-specific manifest filenames. [N2 readiness history](N2_READINESS.md) retains the earlier technical review.

## Checklist for a separately requested future attempt

These steps are a protocol, not authorization. A new attempt requires a concrete reason and explicit user approval; this document does not reopen the completed N2 milestone.

1. Verify the selected PSE runtime path, pinned SHA-256 and signature.
2. Verify the reviewed schema 2 manifest and its Node/addon/harness/dependency/evidence pins. Do not silently accept changed bytes.
3. Run the addon-free dry-run; require ready:true, blockers:[], nativeLoaded:false.
4. Obtain user confirmation that Canon USB and network cameras are physically disconnected. Passive OS inventory is supporting evidence only.
5. Confirm Canon camera hosts and conflicting background clients are closed. Do not stop services or alter Windows settings automatically.
6. Require the independent Job Object supervisor to confirm worker assignment before manifest delivery. Preserve its deadlines and fail-closed checks.
7. Record the user's confirmation of applicable local-use conditions separately from technical readiness. This is not evidence that Canon granted a separate license. Do not invent a universal requirement for written Canon permission or redistribution rights when DLLs are not redistributed.
8. Obtain explicit approval for exactly one native attempt. Empty NODE_OPTIONS and NODE_PATH are required.
9. Execute once: initialize, conditionally terminate only after init=0, then cleanup. No retry, alternative DLL, enumeration, session, callback, camera command or automatic H1/H2/H3 transition.
10. Preserve raw returns, Before/During/After observations, module review, stderr and cleanup evidence in the isolated run directory.

## Portable command template

Set the following variables to the reviewed absolute paths on the test machine; `<reviewed-manifest>` is a placeholder, not a filename supplied by this repository. The Node executable identity must match the manifest.

```powershell
$repoRoot = (Resolve-Path '.').Path
$reviewedNode = (Get-Command node.exe).Source
$n2Manifest = Join-Path $repoRoot 'qa\native-n2-admission\<reviewed-manifest>.json'
& $reviewedNode --no-addons --max-old-space-size=192 tests/native-n1/run.cjs --dry-run --manifest $n2Manifest
```

Only after that attempt's explicit authorization and actual checklist confirmations:

```powershell
& $reviewedNode --no-addons --max-old-space-size=192 tests/native-n1/run.cjs --execute --manifest $n2Manifest --authorize-native-n2 --camera-disconnected --canon-apps-closed --acknowledge-canon-terms
```

Flags record confirmations; they do not create user permission or Canon use rights.

## Result and stop conditions

SOURCE_ZERO_CYCLE requires raw initialize=0 and terminate=0, unloaded=true, comBalanced=true, natural CLEAN_EXIT, confirmed signaled root and empty Job tree, and complete observations without unresolved findings. A nonzero init must not call terminate. Nonzero terminate, crash, a 15-second lifecycle timeout, forced cleanup, unexpected descendant/module/effect or incomplete observations stop the stage without retry. UNKNOWN/exit 3 requires review of the exact process identity and bounded supervisor handoff; a kill request alone is not exit proof.

H1 output layouts and model-specific behavior are separate work. Justify the needed declarations with Canon Reference, available labeled historical headers, Windows x64 ABI and current Koffi bindings, using compile-time probes without DLL loading where useful. An exact public DLL-SHA-to-package mapping is not a universal prerequisite. Never pass an insufficiently justified output structure to native code.

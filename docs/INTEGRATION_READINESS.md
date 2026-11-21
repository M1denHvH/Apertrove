# Integration Candidate readiness — S1 → S2C

Current update (21 November 2026): see [hardware compatibility evidence](HARDWARE_COMPATIBILITY.md) for completed N2/H1A and actual H1 read-only observations, including the preserved raw UNKNOWN and separate GPU-module review. This document retains the historical integration plan. [Actual H2 evidence](H2_VALIDATION.md) now records exposure/Live View and separately authorized AF/lens commands with focus unverified. DATA-005 remains an unchanged baseline capture/H3/release limitation; scoped controls/read-only/UI merge readiness awaits exact final checks, CI, review and user confirmation.

**Обновление IC01, 2026-11-19:** исходный план ниже сохранён как история S2C. Задание IC01 отдельно разрешило и обеспечило official Electron45.3.2 с fail-closed unpackaged fake provider. Actual main/preload/renderer/utilityProcess smoke и текущая классификация gates описаны в `docs/INTEGRATION_CANDIDATE_01.md`; exact final HEAD/commands/exits определяют ignored `qa/integration-candidate/execution-ledger.json`, `smoke-results.json` и `final-verification.json`. Историческое «real Electron не выполнен» ниже относится к S2C, а не к этому новому контуру. Combined lifecycle merge gate закрывается только согласованным final PASS этих receipts и независимым review на том же source; package/vendor/hardware release gates и SEC-004 main CSP остаются открытыми.

Дата: 2026-11-19. Ветка: `feat/s2c-operation-lifecycle`; worktree: `%USERPROFILE%\Desktop\Apertrove-s2c`. Это краткий integration plan, а не новый общий аудит. Точный candidate HEAD, исполненные commands/exits, source hashes и ограничения определяются `docs/SPRINT_S2C.md` и ignored `qa/s2c/` execution/final-verification evidence. Исторические PASS не сертифицируют новый HEAD; наличие test file не считается его выполнением.

## 1. Какие production changes собраны

| Slice | Изменения и граница |
|---|---|
| S1 | Schema/version/fatal UTF-8 gate; detached migration и commit-before-ready; corrupt/future library не заменяется пустой; Retry/Close recovery UI; native-free boot seam |
| S1.5/S2B | Shared storage/boot orchestration; ws 8.23.0/Vite 6.4.6 floors; trusted frontend target; deny-by-default permissions и bounded clipboard IPC; Inspector partial-registration rollback. Main CSP остаётся отдельным незакрытым пунктом |
| S2A | NEW-only JPEG/metadata/preset exports с fresh protected registry и held exclusive handle; registration added/events после persistence ack; retained-copy retry; bounded previous generation, strict ordinary writes и явная BOOT-only degradation |
| S2C candidate | Request/operation/session ownership; timeout сохраняет producer ownership; cooperative cancellation; immutable transfer routing и AMBIGUOUS/EXTERNAL attribution; producer/consumer fence; bounded shutdown и UNKNOWN termination; bounded native-result observations. Доказательства реализации и итоговый scope — в S2C sprint report |

S2C не должен менять ABI layouts, SDK download acknowledgement order или S2A storage/export policy. COM/SDK/model certification не следует из synthetic FSM tests.

## 2. Совместима ли lineage с исходным main

Прочитанная Git history линейна: `d7c9e02` → `7c1652a` → `03919f8` → `4c198f7` → `903db62` → `bc6b91e` → S2C. `git merge-base --is-ancestor` для d7→S1, S1→S1.5 и S1.5→S2A фактически вернул exit0. S2C создан от точного `bc6b91e81e7c7bebd22db4e9fa0913b07db912de`.

Это fast-forward-compatible lineage относительно проверенного исходного main `d7c9e02f09c89d70afdce72cd38ec99fadb05489`. Перед merge нужно повторно проверить ancestry относительно актуального target main; изменение target не разрешает автоматический reset/rebase/force. Два унаследованных EOL-only script diff остаются вне commits. Прежние worktrees и audit output сохраняются.

## 3. Что готово отдавать на review

S1/S2B/S2A имеют отдельные локальные commits и доказательства pure/mock, actual synthetic filesystem, bounded codec, Remote и React tests в соответствующих sprint reports. Их можно предметно рассматривать сейчас; неизвестная совместимость конкретной камеры не блокирует review несвязанных storage/security fixes.

Для S2C review нужен законченный локальный candidate diff, согласованные main/worker envelopes, воспроизводимые named synthetic traces и независимый reviewer. Новый JS helper отдельно от настоящего wiring не доказывает integration correctness. PR может явно сохранять native/vendor/release gates; закрытие всех 25 backlog cards не является условием создания review PR.

## 4. Минимальный отдельный real Electron smoke

Нужна отдельная авторизация executable/setup и отдельный fail-closed fake camera provider: без Canon/Koffi/WIA fallback. Запуск обычного production worker с тестовой папкой не обеспечивает такую изоляцию. В текущем S2C разрешении real Electron не входит в scope.

Минимальная проверка: cold first-run и valid/legacy boot → corrupt/future recovery и Retry → preload IPC/sender checks → actual utility-process transport с fake provider → import/registration → JPEG/JSON export/cancel/error → close во время delayed operation/transfer/persist. Проверить permissions, `focal-asset`, Inspector open/close, отсутствие pending child processes и честный UNKNOWN после forced worker kill. Browser fixture с focal mocks не заменяет этот smoke. После его PASS не требуется повторять весь старый hardware harness.

## 5. Что требует clean Windows/package gate

Отдельно проверить собранный artifact на поддерживаемой Windows: ASAR/unpacked helper closure, зависимости DLL, запуск без dev tree/SDK, first-run и upgrade/legacy profile, paths с Unicode/пробелами, supported permissions/locked-file/alias policy, normal close и restart recovery. Проверить artifact manifest, third-party notices и license files. Packaging/install/update/release здесь не выполняются.

Реальные crash/power-loss и NTFS races не заменяются fault-injection Promise rejection. Обещания ограничиваются исполненной supported matrix, а не универсальной устойчивостью к любому hostile namespace change.

## 6. BLOCKS MERGE / BLOCKS RELEASE / DEFERRED

| Gate | Классификация и критерий |
|---|---|
| Startup regression, destructive filesystem path, false added/capture/close success, missed late-file event, deadlock или unresolved blocking review finding | **BLOCKS MERGE** затронутого candidate: исправить и повторить точные affected tests |
| Согласованность нового main/worker lifecycle wiring без real Electron fake-provider smoke | **BLOCKS MERGE** combined S2C lifecycle integration; независимые storage/security commits могут рассматриваться отдельно |
| Изменённый native ACK/ref/ABI contract без matching vendor evidence | **BLOCKS MERGE** именно такого изменения/утверждения; его следует исключить из candidate или оставить vendor-gated. Отсутствие camera model evidence само по себе не блокирует unrelated pure fixes |
| Clean Windows/package/installer, model/firmware matrix, physical transfer/shutter/faults, подтверждённая SDK durability/handoff policy | **BLOCKS RELEASE** соответствующих camera/package capabilities; это не требование запустить hardware в S2C |
| DATA-005: download acknowledgement до успешной локальной записи; S3T durable handoff | **BLOCKS RELEASE** заявления о безопасном camera-original handoff. Порядок ACK не переставляется без matching reference |
| UI polish, дополнительные layouts/models, measured performance/cache improvements, расширение RAW/Bulb/video, trusted-LAN TLS/pairing research | **DEFERRED IMPROVEMENT**, если нет новой регрессии безопасности, data loss или явного supported-workflow blocker |

Готовность к review, разрешение merge и пригодность публичного release — разные решения. Нельзя объявлять native certification на основании того, что review PR создан или synthetic suite прошёл.

## 7. Canon/vendor/hardware неизвестные

В ограниченно проверенных local sdk/vendor и известных Canon installation roots matching `EDSDK.h`, `EDSDKTypes.h`, `EDSDKErrors.h` и API Programming Reference не найдены. Исторический DLL file version/zero-camera run не связывает текущую handwritten binding с конкретным SDK package. Необходимы легально предоставленные matching package/architecture/prototype evidence, callback/ref/quiescence и Complete/Cancel contracts; затем отдельно разрешённые model/firmware H1/H2/H3 traces. Proprietary SDK не скачивается и не загружается автоматически.

Практическое ограничение S2C: SDK object callback не даёт подтверждённого app capture key. Stable delivery route сохраняет файлы в известной session/folder, но definite captureId/series/burst не выдумываются. После meaningful session/destination boundary uncorrelated arrivals направляются в recovery folder с `sessionId:null`, даже если часть из них реально относится к новому capture. Quarantine сохраняется и через logical native epoch/reconnect: callback не предоставляет origin epoch, поэтому логическая смена поколения не доказывает quiescence. Первое установление route из пустого состояния выделено отдельно. Quiet-window не снимает ограничение. Файлы доступны в Library среди всех сессий / без сессии; нельзя скрывать unconfirmed receipt как fully confirmed capture.

## 8. Что UI/UX и performance могут оставить в backlog

S3U keyboard burst/modal focus, более полный accessibility/theme/high-DPI/mobile matrix и recovery UX можно планировать отдельно от pure storage/security review. Новый ownership/cancel/UNKNOWN feedback обязан быть понятным уже в затронутом S2C workflow; сохранённые ambiguous files не должны исчезать из доступного пользователю состояния.

PERF-001/002 остаются measurement-first: import scale, streaming/index cost, preview cache/asset retention. Не требуется speculative rewrite или новый benchmark framework ради первого PR. Явное превышение bounded budget или новая утечка вследствие candidate становится regression blocker, а не deferred optimization. Main CSP compatibility и trusted-LAN TLS имеют отдельные security follow-ups; существующие frontend/permission/auth protections сохраняются.

## 9. Кратчайшая безопасная последовательность к первому PR

1. Завершить S2C scoped implementation, независимый review и один coherent final pass на точном локальном HEAD; сохранить FAIL/NOT RUN и hashes, не коммитить fixtures/logs.
2. Зафиксировать Integration Candidate локальными atomic commits; проверить lineage, clean index и только две известные inherited EOL differences. Составить компактный review diff S1→S2C с contract boundaries этого документа.
3. Выполнить отдельно разрешённый minimal Electron fake-provider smoke. Если lifecycle merge gate не закрыт, отделить его review scope от готовых pure storage/security fixes, сохранив исходную историю; не делать destructive history rewrite.
4. После явной авторизации публикации подготовить review PR в main с точным candidate SHA, актуальными test receipts и разделёнными merge/release/vendor gates. До merge пройти проверки ниже и reviewer approval.
5. Camera/S3T/clean-Windows release work продолжать отдельными ограниченными gates. Не ждать всего backlog ради review PR; не обходить незакрытый merge blocker ради release deadline.

Эта последовательность не выполняет push, PR creation, merge или release автоматически.

## 10. Точные проверки непосредственно перед merge

Сначала review final entrypoints/closure и runtime admission. Очистить `NODE_OPTIONS`/`NODE_PATH`; задать `APERTROVE_SOURCE_COMMIT` из проверенного полного candidate HEAD. Команды ниже — минимальный rerun plan, не самостоятельная авторизация более высокого tier. Exact commands/exits/runner hashes окончательно фиксируются в `qa/s2c/` ledger.

```text
node --no-addons --max-old-space-size=192 tests/s2c/lifecycle.cjs --tier T1 --scope synthetic
node --no-addons --max-old-space-size=192 tests/s2c/transport.cjs --tier T2 --scope synthetic
node --no-addons --max-old-space-size=192 tests/t1-runner.cjs --tier T1 --scope synthetic tests/t1/library-schema.test.cjs tests/t1/library-bootstrap.test.cjs tests/t1/boot-state.test.cjs tests/t1/isolation.test.cjs
node --no-addons --max-old-space-size=192 tests/t2/security-policy.cjs --tier T1 --scope synthetic
node --no-addons --max-old-space-size=192 tests/s2a/export-policy.cjs --tier T1 --scope synthetic
node --no-addons --max-old-space-size=192 tests/s2a/registration.cjs --tier T1 --scope synthetic
node --no-addons --max-old-space-size=192 tests/s2a/recovery.cjs --tier T1 --scope synthetic
node --no-addons --max-old-space-size=192 tests/s2a/filesystem.cjs --tier T2 --scope synthetic
node --no-addons --max-old-space-size=192 tests/t2/storage.cjs --tier T2 --scope synthetic
node --max-old-space-size=512 node_modules/vite/bin/vite.js build
node --no-addons --max-old-space-size=192 scripts/check-i18n.cjs
node --no-addons --max-old-space-size=192 scripts/preflight.cjs
```

При изменённой codec closure: отдельно reviewed `node --max-old-space-size=192 tests/s2a/codec.cjs --tier T2 --scope synthetic --allow-native-sharp`; это единственное Sharp addon exception, без Canon. При изменённом command dispatch: reviewed `node --no-addons --max-old-space-size=128 tests/t2/remote-loopback.cjs --allow-t2-loopback` только после literal-loopback admission. При изменённом UI lifecycle: reviewed `node --no-addons --max-old-space-size=192 tests/t2/renderer.cjs` после build и проверки installed Edge/synthetic profile. `fake-worker.cjs` запускается только как child transport suite с собственным heap128 budget, не как самостоятельный test command.

Дополнительно: повторить minimal real Electron smoke на том же candidate после отдельного допуска; `git diff --check`, source/native/build asset hashes, original before/after SHA, reference ledger, worker/socket/handle cleanup, final persistence receipt, отсутствие false CLOSED после force и `git merge-base --is-ancestor` относительно target main. При последующем изменении production wiring повторяется affected slice и окончательная привязка HEAD; прежний PASS не переносится на новые bytes.

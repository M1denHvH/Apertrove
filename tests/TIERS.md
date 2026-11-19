# Test tiers и разрешённый S1 scope

S1 baseline: d7c9e02f09c89d70afdce72cd38ec99fadb05489. Все существующие test scripts классифицированы чтением исходников, а не запуском.

## Единственная S1 T1 allowlist

tests/t1/policy.cjs задаёт ровно четыре entrypoint:
- tests/t1/library-schema.test.cjs
- tests/t1/library-bootstrap.test.cjs
- tests/t1/boot-state.test.cjs
- tests/t1/isolation.test.cjs

Runner: tests/t1-runner.cjs. Он требует --tier T1 --scope synthetic и конкретные имена файлов. Нет wildcard discovery; неизвестные entrypoints, scope, tier, duplicates/traversal отклоняются до загрузки. Default npm test не изменён и **не является S1-safe command**.

Команда после очистки NODE_OPTIONS/NODE_PATH в текущем shell:

```powershell
node --no-addons tests/t1-runner.cjs --tier T1 --scope synthetic tests/t1/library-schema.test.cjs tests/t1/library-bootstrap.test.cjs tests/t1/boot-state.test.cjs tests/t1/isolation.test.cjs
```

Важно очистить Node preload environment **до** запуска Node; проверка runner не может отменить уже выполненный NODE_OPTIONS preload. Полная фактически выполненная shell-команда и results описаны в docs/SPRINT_S1.md.

## Изоляция

Trusted harness читает только exact reviewed sources и пишет qa/s1/t1-results.json. Самим test modules не предоставлены process, fetch, Buffer, timers, fs, network, subprocess, Electron, Sharp, Koffi или SDK. Разрешены built-in assert/strict, path, crypto и узкий TextDecoder из util, плюс exact local whitelist. Storage ports используют memory Map, два virtual paths и неизменяемый synthetic original fixture.

Scanner проверяет полный literal CJS graph перед исполнением. Dynamic import/computed require/eval/Function запрещены в reviewed closure. 14 явно перечисленных forbidden imports в isolation test — отрицательные probes; они обязаны получить T1_IMPORT_DENIED **до module resolution**, а не MODULE_NOT_FOUND.

Это reviewed-code sentinel, **не OS sandbox** и не обещание безопасного исполнения неизвестного JS. Node VM не является границей безопасности для враждебного кода; 2s Promise watchdog не прерывает synchronous CPU loop. Текущий closure прочитан двумя независимыми reviewers и содержит конечные контролируемые cases. Native-module count в report выведен из закрытого loader policy, не из независимого мониторинга SDK/ОС.

Production filesystem adapter и Electron main вообще не импортируются T1. Реальные файловые fixtures автоматически pure не считаются.

## Классификация baseline56 файлов

Ни одна строка ниже **не добавляет legacy script в allowlist**.

| Группа | Файлы | Уровень / ограничения |
|---|---|---|
| 13 pure candidates | camera-control.test.cjs; camera-destinations.test.cjs; camera-discovery.test.cjs; capture-timing.test.cjs; equipment.test.cjs; focus-info.test.cjs; i18n.test.cjs; lighting-colors.test.cjs; native-focus.test.cjs; preset-series.test.cjs; remote-appearance.test.cjs; shutter-latch.test.cjs; workspace.test.cjs | Возможный T1 после отдельного entrypoint/closure review. Lighting-colors имеет ESM import, equipment содержит network-capable function; не допущены текущим runner |
| 10 mixed/native/I/O | camera-capabilities.test.cjs; flash-bridge.test.cjs; image-quality.test.cjs; library.test.cjs; metadata.test.cjs; native-buffer.test.cjs; photo-delete.test.cjs; remote-server.test.cjs; session-delete.test.cjs; sessions.test.cjs | Не автоматически T1: filesystem, child_process, codecs, native memory или listeners. sessions после S1 больше не тянет Sharp, но старый entrypoint всё равно не включён |
| 20 application/UI | appearance.cjs; designs.cjs; focus-flash-ui.cjs; i18n-ui.cjs; iris-appearance-ui.cjs; live-resize-ui.cjs; onboarding-ui.cjs; photo-delete-ui.cjs; refinement-ui.cjs; remote-appearance-ui.cjs; remote-controls-ui.cjs; remote-layout-audit.cjs; session-delete-ui.cjs; smoke.cjs; studio-inspector-ui.cjs; studio-ui.cjs; ui-layout-audit.cjs; ui-state-audit.cjs; unified-appearance-ui.cjs; workspace-ui.cjs | T2 app minimum; actual native isolation не доказана. Для некоторых worker substitution есть, но не для всех. Нельзя запускать без отдельного разрешения |
| 8 hardware-enabled | af-probe.cjs; af-ui.cjs; benchmark-live.cjs; debug-live.cjs; focus-flash-hardware.cjs; hardware.cjs; integration.cjs; probe-camera.cjs | Максимальный наблюдаемый путь H2: property/focus/EVF/WIA/destination. Connect не автоматически read-only |
| 2 capture-enabled | remote-integration.cjs; studio-hardware.cjs | H3 maximum: shutter/burst по flags; discovery/connect происходят и до capture flag |
| 2 helpers | select-control.cjs; test-session.cjs | Не самостоятельные safe tests; test-session создаёт app session |
| 1 asset generator | make-icon.cjs | Sharp + file writes; не T0/T1 test |

FOCAL_TEST_DATA — перенаправление userData, **не запрет SDK/WIA**. integration вызывает Connect до FOCAL_EXPECT_CAMERA; remote-integration делает discovery/connect до capture flag. Физически отключённая камера также не гарантирует отсутствия SDK calls.

## Канонические уровни

T0: read-only source/config и parse-only checks.

T1: reviewed pure/mock scope с synthetic memory ports.

T2: отдельно разрешённый isolated app/native-stub/codec/network runtime, без Canon по умолчанию.

T3: clean Windows/VM, package/ACL/path aliases/high DPI.

H1: explicit read-only camera diagnostics.

H2: explicit properties/focus/EVF/WIA/card import без shutter.

H3: **любой shutter/capture**, burst/timer и faults during capture.

Смена уровня требует отдельного разрешения. Ни S1 runner, ни этот документ не разрешают T2/T3/H execution.

## Именованные S1.5 + S2B контуры

В отдельном integration worktree по явному заданию S1.5+S2B рассмотрены и выполнены только следующие новые entrypoints (они намеренно не `*.test.cjs`):

| Entry | Уровень / допуск |
|---|---|
| `tests/t2/storage.cjs --tier T2 --scope synthetic` | T2 actual FS/shared boot через closed graph и confined adapter; только disposable qa/integration/fixtures |
| `tests/t2/security-policy.cjs --tier T1 --scope synthetic` | **T1 VM mocks**, actual policy/Inspector/preload JS, никакого Electron runtime |
| `tests/t2/remote-loopback.cjs --allow-t2-loopback` | T2 standalone HTTP/WS на literal127.0.0.1, fixed fake interfaces/callbacks, disabled optional addons, bounded traffic/cleanup |
| `tests/t2/renderer.cjs` | T2 actual built React в проверенном installed Edge, synthetic profile/environment; actual guarded storage boot, явный focal RPC fixture; не Electron IPC |

У всех обязательны `node --no-addons`, пустые NODE_OPTIONS/NODE_PATH. Remote/renderer требуют APERTROVE_SOURCE_COMMIT=полный проверенный HEAD. Конкретные команды, память/время, physical hashes, previous failures, limitations и compatibility matrix: `docs/SPRINT_S1_5_S2B.md` и ignored qa/integration reports.

Это не разрешает запуск default `npm test`, прежних app/hardware scripts, Electron download/setup или T3/H. Library import/export/Inspector checks в browser fixture означают UI dispatch с cancelled/mock result; native file/codec success не заявляется. Actual Electron gate и main CSP acceptance остаются BLOCKED.

## Именованные S2A контуры

S2A добавляет пять opt-in entrypoints; ни один не добавлен в wildcard discovery или default npm test. Общие условия: пустые `NODE_OPTIONS`/`NODE_PATH`, полный проверенный `APERTROVE_SOURCE_COMMIT`, generated synthetic fixtures. Полные commands/exits и source hashes находятся в ignored `qa/s2a/execution-ledger.json` и `qa/s2a/final-verification.json`; контракты — `docs/SPRINT_S2A.md`.

| Entry / аргументы | Допуск и фактическая граница |
|---|---|
| `tests/s2a/export-policy.cjs --tier T1 --scope synthetic` | T1 actual export helper в closed VM, model FS/aliases/faults; 20 s total, 2 s/case; не codec/OS evidence |
| `tests/s2a/registration.cjs --tier T1 --scope synthetic` | T1 actual committer/schema, memory writer; 15 s total, 1 s/case; staged/ack/queue/dedup assertions |
| `tests/s2a/recovery.cjs --tier T1 --scope synthetic` | T1 actual recovery/schema/text helpers, memory FS; 15 s total, 1 s/case; controlled interruption/close/backup faults |
| `tests/s2a/filesystem.cjs --tier T2 --scope synthetic` | T2 actual export routes/owned handles/import copy/registration/recovery через `fs-guard.cjs`; fixtures только `qa/s2a/fixtures`; 30 s total, 3 s/case, 180 files, 3000 operations, 1 MiB/file, 16 MiB aggregate read/write, 8 handles |
| `tests/s2a/codec.cjs --tier T2 --scope synthetic --allow-native-sharp` | T2 exact reviewed Sharp 0.35.5 addon + bundled DLL assets, exifr JS closure, generated 32×24 RGB/JPEG buffers; 30 s total including preflight, ≤4096 pixels, ≤1 MiB/buffer, 512 MiB sampled RSS cap |

T1 и filesystem запускаются с `node --no-addons --max-old-space-size=192`; codec — с `node --max-old-space-size=192` **без** `--no-addons`, только после отдельного source/native-asset hash review. Codec отключает global libvips/plugins, очищает preload/native environment, допускает единственный exact addon и ограничивает child-process/network/module attempts. Встроенный `zlib` нужен actual exifr; optional native modules не разрешены. Positive JPEG evidence: actual production `renderEditedBuffer`, SOF dimensions, native decode, changed pixels и actual held-handle write. Metadata/preset JSON независимо разбираются. Guard не является OS sandbox; Windows DLL loader не инструментирован независимо.

S1/S1.5 регрессии выполняются заново на S2A HEAD. `tests/t2/guard.cjs` дополнен только recovery dependency, `crypto.createHash` и confined `open('wx')`/handle write/close. Renderer дополнен metadata reject/retry/cancel и missing-primary/backup/degraded-boot cases: actual built React + guarded storage, focal/dialog/service transport остаётся fixture. Это не actual Electron IPC или OS Save dialog test. Source packaging preflight выполняется без создания архива. Electron/Canon/EDSDK/Koffi/WIA/PTP, реальные фотографии/profiles, T3 и packaged execution по-прежнему не разрешены.

## Именованные S2C контуры

Общий допуск: empty `NODE_OPTIONS`/`NODE_PATH`, полный `APERTROVE_SOURCE_COMMIT`, explicit flags, отдельный прочитанный entrypoint и полный execution graph. Новые файлы не входят в default `npm test` / wildcard discovery.

| Entry | Допуск / предел |
|---|---|
| `tests/s2c/lifecycle.cjs --tier T1 --scope synthetic` | `node --no-addons --max-old-space-size=192`; closed 9-module pure VM; fake transport/clock/SDK/reference ledger, transfer/registration ports in memory, shutdown/error/series traces; 15 s total, 1 s/case, max70 cases |
| `tests/s2c/worker-capture.cjs --tier T1 --scope synthetic` | Тот же Node prefix; только выделенные capture/fail/settle/stop функции actual worker source + pure latch/observations в VM; fake JS SDK, 10 s total; весь worker, Koffi и callback ABI не выполняются |
| `tests/s2c/transport.cjs --tier T2 --scope synthetic` | `node --no-addons --max-old-space-size=192`; actual Node IPC с exact `fake-worker.cjs`, максимум1 concurrent/3 sequential children, каждый `--no-addons --max-old-space-size=128`; 30 s suite, 2 s wait, 128 messages/child. Actual S2A registration/recovery через confined `qa/s2c/fixtures` FS: 500 operations, 1 MiB/file, 4 MiB reads и writes, 4 handles |

Fake child не standalone entry; только exact caller args/environment/fixture, без SDK loader/fallback, Electron, native addons или network. В T2 проверяются controlled crash/hang/force, late file, registration acknowledgement, actual rename failure/retry, physical original SHA и owned process/handle cleanup. Эти доказательства не являются actual Electron utilityProcess/IPC или vendor native lifecycle certification.

S2C renderer fixture дополнен событиями operation ownership и synthetic burst pointer down/up: busy после timeout/drain, отпускание удерживаемого затвора остаётся доступным, unconfirmed receipt не показывает saved-count success. Физический camera provider по-прежнему отсутствует. Последовательность финальных регрессий, команды/exits/counts и source hashes находятся в `docs/SPRINT_S2C.md` и ignored `qa/s2c/`. Real Electron smoke остаётся отдельной авторизацией executable/setup и fail-closed fake provider; T3/H не разрешены.

## Именованный IC01 real Electron контур

Задание Integration Candidate 01 отдельно разрешает exact official **Electron 45.3.2 win32-x64** только после проверки archive/executable/supporting-file SHA и fail-closed provider admission. Исторические ограничения выше описывают прежние спринты; новый допуск не распространяется на legacy harness, T3 или hardware.

```text
node --no-addons --max-old-space-size=256 tests/ic01/smoke.cjs --tier T2 --scope synthetic --allow-electron-ic01
```

Обязательны пустые `NODE_OPTIONS`/`NODE_PATH`, полный `APERTROVE_SOURCE_COMMIT`, candidate cwd, reviewed build и exact runtime в ignored `qa/integration-candidate/runtime/`. Runner использует actual main/preload/React, Electron `utilityProcess`, actual Sharp на generated fixtures и fixed dialog outcomes. `entry.cjs` до загрузки main устанавливает одноразовый unpackaged composition port с точным `fake-camera.cjs`; normal Canon worker, Koffi/SDK, WIA/PowerShell, shell actions и fallback запрещены. Main/Inspector/host guards, negative fail-before-load probes, synthetic profile paths и записи SHA входят в evidence. Test drivers недоступны renderer/LAN и packaged app; default npm scripts не изменены.

Пределы: 240 s suite, 25 s/group, максимум14 последовательных applications/1 concurrent, 75 s/application, максимум8 utilities/application с heap128. Фактическая матрица — 20 групп/12 applications. Inspector запускает настоящий codec worker через confined wrapper и проверяет повторное открытие, IPC и token policy. Foreign sandboxed subframe probe доказывает отказ чужому WebContents с subframe; не заявляется отдельная проверка только mainFrame-ветви на том же production WebContents. Разрешены лишь localhost debugger connections; браузерный egress закрыт. Счётчики guards и profile redirection не являются OS sandbox или независимой инструментализацией Windows DLL loader.

Exact commands/exits/HEAD/source hashes, protected originals, shutdown outcomes и process cleanup сохраняются в `qa/integration-candidate/`; исходные admission receipts — снимки **до запуска**, runtime evidence — отдельный smoke report. `docs/INTEGRATION_CANDIDATE_01.md` описывает результат и scope. Старые именованные регрессии выполняются на том же финальном HEAD, включая дополненный security T1 (30 проверок deferred/rejected clipboard acknowledgement). Main SEC-004 CSP остаётся OPEN; package/ASAR/installer/clean Windows, vendor ACK/ref/ABI, реальные RAW/model timing и hardware certification не входят в IC01.

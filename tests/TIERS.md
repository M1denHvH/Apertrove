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

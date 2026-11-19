# Sprint S1.5 + S2B — integration verification and security maintenance

Дата: 2026-11-19. Ветка: `feat/s1-integration-security`. База: точный S1 commit `7c1652aec1adf7a6e7c5c69792c979cbf46547dc`.

## Executive result

Получены три практических T2 контура: настоящий filesystem adapter и shared boot orchestration; настоящий HTTP/WebSocket Remote на loopback; настоящий собранный React в установленном Edge с synthetic profile и явным mock focal transport. Это не запуск Electron и не сертификация native paths.

Подтверждены missing/legacy/v1/v2 startup, сохранность повреждённых/неподдерживаемых bytes, реальные ошибки чтения и persist, Retry после ремонта fixture, singleflight, shutdown и partial-services retry. В React проверены recovery/focus/keyboard Retry, repeated error без overwrite, переход в ready после изменения настоящего synthetic файла, первый onboarding, навигация и сохранение темы через настоящий adapter.

Результаты до commit: S1 T1 **41/41**, security VM T1 **29/29**, storage T2 **19/19**, Remote T2 **14/14**, renderer T2 **7 групп**. Финальные прогоны выполняются после commit; точный HEAD, execution-tree/source/dist SHA, команды, exits и актуальные пути отчётов записываются в игнорируемый `qa/integration/final-verification.json`.

## Git

- Новый worktree `Apertrove-integration` создан от точного S1, без переноса старых patches.
- Первый commit: `03919f85ab0993438fb0a38f3f38f86d31807356`, `fix: patch ws and vite security advisories`.
- Следующий commit содержит общий boot/storage seam, trusted frontend/permissions, Inspector rollback, named tests и этот документ. Итоговый SHA фиксирует final-verification; HEAD самого отчёта не встраивается в собственное содержимое.
- Исходные `scripts/preflight.cjs` и `scripts/source-files.cjs` EOL differences не исправляются и не включаются в commits.
- Push, merge, reset, clean, package/release, изменение исторических audit reports не выполнялись.

## Coordination and independent review

| Роль | Работа и найденные проблемы |
|---|---|
| integration_qa | Actual storage adapter/closed graph, 19 filesystem cases; security VM suite. Исправлена ошибочная идея blocker в parent library: она даёт UNREADABLE, поэтому PERSIST_FAILED создаётся через captureFolder. Найдены partial IPC registration и HEX clipboard compatibility. |
| integration_desktop | Actual React/Edge fixture, production boot graph, keyboard/onboarding/settings, явные отмены dialogs; legacy i18n-ui признан недостаточным admission и не запускался. |
| integration_remote | Официальные advisories, минимальный lock diff, bounded Remote suite, negative probes и cleanup. |
| s15_reviewer | Независимый read-only production/test/evidence review. Найдены async clipboard result, hidden window на invalid dev URL, renderer ancestor/timeout gaps, ложноположительный Equipment header check и отсутствующий preview mock. Исправления проверены; material production blockers не осталось. |
| Root | Последовательная интеграция shared files, npm/build/test execution, визуальный read-back, commits и итоговая сверка SHA. |

Agents не запускали приложение/native-код. У каждого были отдельные owned files; shared production files менял root. Правила token-efficiency использовались для bounded reads. UI не перепроектировался.

## Implemented fixes

### Storage and boot integration

- `electron/library-storage.cjs` содержит единственную прежнюю реализацию atomicJSON, fatal UTF-8 reader и boot writer с captureFolder mkdir. `library.cjs` реэкспортирует тот же writer; eager Sharp не нужен storage tests.
- Main использует этот adapter и `createBootApplication` из `electron/boot-application.cjs`. Порядок commit → services → appearance → public state сохранён; после service failure Retry использует уже committed bootstrap. Добавлена проверка quitting перед ready publication.
- `asarUnpack` дополнен storage/text closure. Это source/config проверка, не packaged execution.
- Inspector откатывает только успешно зарегистрированные в текущей factory IPC handlers при синхронном registration failure. Protocol регистрируется после IPC loop. Проверены fault на втором/третьем handler, protocol fault и сохранение preexisting protocol.

### SEC-001 / SEC-002

Официальные ranges проверены 2026-11-19:

- ws GHSA-37g9-w4hg-h9qr: relevant affected `>=8.0.0 <8.23.0`, fixed **8.23.0**.
- Vite GHSA-p4f5-76q4-ffq7: relevant affected `>=4.0.0 <=6.4.5`, fixed **6.4.6**. Риск относится к exposed dev server; packaged RCE не заявляется.

Официальные источники: GitHub Security Advisories соответствующих upstream repositories. Первые исправленные совместимые версии не называются глобально последними major releases.

Root floors: `ws ^8.23.0`, `vite ^6.4.6`. В lock изменены только root constraints и version/resolved/integrity этих двух пакетов. Другие direct/transitive версии и npm scripts не изменены. Remote production source не менялся и не отключён.

Установка: две package-lock-only операции и `npm ci`, всегда `--ignore-scripts --no-audit --no-fund`, отдельный cache и пустые user/global npmrc под qa/integration, synthetic npm home/temp. Установлено 406 пакетов. Lifecycle manifests сохранены в `dependency-review.json`; отсутствие lock hasInstallScript не трактуется как отсутствие scripts. Никакой postinstall вручную не запускался.

Для build отдельно рассмотрены уже установленные esbuild 0.25.12 и Rollup 4.65.0 binaries, их SHA сохранены. Запускался только Vite build; native setup/rebuild не выполнялись. Electron executable после ignore-scripts отсутствует; download не выполнялся.

### SEC-003

Main и Inspector используют одну policy `frontendTarget`:

- Packaged игнорирует FOCAL_DEV_URL, загружает только фиксированный dist entry.
- Unpackaged override допускает только origin `http://127.0.0.1:5173`, root path, без credentials/query/hash. Другие origins, schemes, ports и entries отклоняются.
- Target проверяется до создания окна. Повторный invalid Inspector open не оставляет hidden window.
- Vite явно использует тот же loopback host/port с strictPort. При занятом 5173 dev server должен завершиться, а не молча перейти на другой порт.

### SEC-004 compatibility matrix and partial implementation

| Workflow | Требуемый контракт | Фактическая проверка / решение |
|---|---|---|
| Main native browser permissions | Deny request/check по умолчанию | Callbacks проверены в VM; main wiring source-confirmed. Actual Electron session smoke BLOCKED. |
| HEX copy | UI сохраняет успех/ошибку clipboard | Переведено на sender-gated copyColor IPC, exact 7-character HEX; Promise clipboard writer ожидается. Deferred/rejected writer проверены VM; React dispatch проверен. OS clipboard NOT RUN. |
| Inspector copy | Bounded existing IPC | Actual Inspector JS в VM, limit/sender guard сохранены. OS clipboard NOT RUN. |
| Scripts/fonts | External appearance startup, bundled JS/Manrope | Vite build и настоящий browser asset/font load PASS. |
| Styles | Inline React/appearance/GSAP styles | Нельзя автоматически запретить unsafe-inline styles. Existing policy сохранена. |
| Preview/focus/Remote QR | focal-asset:, data:; canvas Blob decoding | Browser data/blob/canvas PASS; Electron focal-asset и actual codec NOT RUN. |
| Workers | Source не создаёт browser Worker в main; Inspector utility worker native | Native worker недостижим в tests; Electron worker workflow BLOCKED. |
| Dev/HMR | React refresh inline bootstrap, HTTP/WS exact loopback | Source/config reviewed; новый main CSP потребовал бы dev-only transform и actual smoke. HMR runtime NOT RUN. |

**Main CSP не внедрена**: actual Electron custom scheme/permissions/packaged acceptance недоступны. Generic browser canvas test не заменяет этот gate. Existing Inspector CSP не ужесточалась. SEC-004 частично выполнен (permissions + совместимый clipboard path), CSP остаётся BLOCKED.

## Reviewed commands and actual results

Все команды из integration worktree. Перед tests очищаются NODE_OPTIONS/NODE_PATH; Remote и renderer получают `APERTROVE_SOURCE_COMMIT` из `git rev-parse HEAD`. Не выполнять glob/default npm test.

| Команда | Exit / результат |
|---|---|
| `npm install ws@8.23.0 --save-prefix=^ --package-lock-only --ignore-scripts --no-audit --no-fund` + explicit isolated cache/config | 0; только admitted lock changes |
| `npm install vite@6.4.6 --save-dev --save-prefix=^ --package-lock-only --ignore-scripts --no-audit --no-fund` + те же isolation flags | 0 |
| `npm ci --ignore-scripts --no-audit --no-fund` + те же isolation flags | 0; 406 packages |
| `node --max-old-space-size=512 node_modules/vite/bin/vite.js build` с reviewed ESBUILD_BINARY_PATH | 0; оба entrypoint собраны |
| `node --no-addons tests/t1-runner.cjs --tier T1 --scope synthetic tests/t1/library-schema.test.cjs tests/t1/library-bootstrap.test.cjs tests/t1/boot-state.test.cjs tests/t1/isolation.test.cjs` | 0; 41 PASS, 14 import probes |
| `node --no-addons --max-old-space-size=192 tests/t2/storage.cjs --tier T2 --scope synthetic` | 0; 19 PASS, 15 import + 6 path probes |
| `node --no-addons tests/t2/security-policy.cjs --tier T1 --scope synthetic` | 0; 29 PASS; это VM T1, хотя файл находится в t2 directory |
| `node --no-addons --max-old-space-size=128 tests/t2/remote-loopback.cjs --allow-t2-loopback` | 0; 14 PASS; 7 expected denials, 0 unexpected |
| `node --no-addons --max-old-space-size=192 tests/t2/renderer.cjs` | 0; 7 grouped checks, 0 unexpected; actual React, mocked transport/services |

Имена qa reports: `storage-results.json`, `security-policy-results.json`, `remote-results.json`, `fixtures/renderer-*/report.json`, соответствующие console logs. Они содержат source hashes, fixture paths, actual assertions и residual risks. Final-verification связывает reports с итоговым HEAD и hashes frontend/dist/runner.

### Resource limits and physical hashes

- Storage: 25 s total, 3 s/case, 500 adapter operations, 1 MiB/file, 8 MiB aggregate read/write, 128 fixture files. Actual SHA original: `a01421a55579302609ec92ecf9dc3a028f67a73e525192298b2c5a9245ff0e8d`, до/после совпадает.
- Remote: 128 MiB Node, 30 s hard total, 2 s ordinary waits, 6.5 s auth-timeout case, max4 clients/128 events, один 17 KiB oversized payload. Observed successful run: 93 events, 32 Ping +32 Pong, максимум2 WS clients/3 sockets; cleanup0. Никакой DoS/RCE PoC не выполнялся; capped Ping не доказывает достижение upstream queue threshold.
- Renderer: 192 MiB Node heap, 85 s deadline/88 s emergency exit, один Edge spawn, exact synthetic profile/environment, max350 fixture requests/8 KiB RPC body. В observed run 7 groups завершились примерно за 5.4 s. Physical synthetic PNG SHA всех трёх cases: `8d9e32c009c7b4b82a3d9915625dafab582d58699f2bc727bd15e5c06e1c4fe1`, до/после совпадает.
- Guards — reviewed-source allowlists/sentinels, **не OS sandbox для hostile JavaScript**. Playwright/подписанный installed Edge доверенные; page egress/host Node sockets ограничены, browser background functions отключены, resolver исключает всё кроме loopback. Root Edge exited; отдельный process query не нашёл synthetic Edge processes.

### Failed attempts and stop conditions

1. Первый sandbox npm attempt получил EPERM при создании отдельного cache; package/lock не изменились. Повтор с разрешённой записью в новый worktree и теми же ignore-scripts flags успешен.
2. Первый Remote T2: guard остановил `dns.lookup('127.0.0.1')` на Node24, exit1, до listening. Evidence сохранён в `remote-attempt1-results.json`; cleanup0. Исправлен только fixture lookup: возвращает synthetic literal IPv4, реальный DNS не вызывается.
3. Первый renderer T2: exit1 на pageerror отсутствующего renderPreview mock; sentinel violations0. Evidence сохранён. Добавлен явный fixed PNG mock; успешный повтор не объявляет codec test.
4. Read-only process query сначала denied sandbox, затем разрешённый read-only повтор дал0 matching synthetic processes. Automatic approval одной patch операции истёк по timeout, не отвергнув безопасность; перед успешным повтором файл перечитан.

Ни один отказ не превращён задним числом в PASS. Real camera/userData/native SDK paths не предоставлялись tested production modules. Canon DLL/Koffi/camera-worker/WIA attempts вне намеренных intercepted sentinel probes не наблюдались; это derived guard evidence, не независимая OS tracing certification.

## Regression matrix

| Функция | Доказанный уровень | Что остаётся |
|---|---|---|
| Missing/valid/versionless/v1/v2 startup | T2 physical FS/shared boot; valid/fresh actual React | Actual main/preload IPC и полный main prepareLibrary |
| Corrupt/future/unreadable/persist failure | T2 physical error+SHA; React corrupt recovery | Windows ACL, aliases, Electron recovery window |
| Retry/partial services/shutdown | T2 shared orchestration; actual Inspector factory in VM | Real OS service faults/shutdown |
| First onboarding | Actual React welcome/environment/skip with physical persistence | Full wizard with permitted camera provider |
| Existing settings | Unknown fields/path/rating retained T2; theme saved React+FS | All settings/native side effects |
| Navigation | Sessions/Capture/Library/Presets/Equipment/Tools/Remote/Settings + Lighting UI | Hardware-dependent controls, preset series runtime |
| Library import / photo export | React button/shortcut/cancel dispatch | OS dialogs, native codec, file commit NOT RUN |
| Preset import/export | React JSON button/cancel dispatch | Actual file read/write NOT RUN |
| Metadata export | Unchanged source only | Runtime NOT RUN |
| Preview/Inspector | Browser synthetic image/canvas/assets; UI open dispatch; Inspector VM | Electron custom scheme, worker, Sharp/native preview NOT RUN |
| LAN Remote | Actual protocol/frontend route tests на loopback | Real LAN/mobile/browser behavior NOT RUN |

## Blockers and open gates

- Actual Electron mock-app gate BLOCKED: Electron executable отсутствует после authorized ignore-scripts install. Binary download/postinstall отдельно не разрешены и не выполнялись. Existing legacy harness недостаточен: utilityProcess fallback/WIA/Sharp reachable.
- Поэтому main/preload/storage/renderer как единый Electron runtime, native clipboard/permissions/focal-asset и packaged CSP не доказаны. Preload/Inspector в VM не считаются IPC runtime.
- T3/clean Windows/package/ACL/aliases/high-DPI; Canon/EDSDK/vendor contract; device discovery, focus, EVF, shutter/capture/burst и hardware faults остаются открыты.
- Inherited property-order JSON.stringify comparison между main emptyEdits и library DEFAULT_EDITS может лишний раз вызывать preview. Обнаружено через fixture; production не рефакторился вне scope.

## Next implementation: prerequisites for S2A

1. Согласовать invariants export/persist: originals immutable, cancellation не выдаёт success, один serial writer/ownership, ошибки publish после failed commit.
2. Разрешить конкретный isolated codec/dialog test gate; независимый synthetic export output root, original/output hashes и real cancellation/failed write assertions.
3. Подготовить exclusive destination creation/temp+commit protocol, collision/race/path containment tests; не считать atomic rename достаточным для всех ACL/alias/overwrite cases.
4. Для Windows aliases/ACL и packaged/native regressions получить отдельный T3 gate. Для camera paths сначала matching vendor evidence и отдельное разрешение hardware tier.

S2A/S2C в этом спринте не начаты.

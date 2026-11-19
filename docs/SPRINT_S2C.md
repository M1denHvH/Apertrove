# S2C — operation ownership, transfers and bounded shutdown

Дата: 2026-11-19. Worktree: `%USERPROFILE%\Desktop\Apertrove-s2c`; branch: `feat/s2c-operation-lifecycle`. Точный исходный HEAD: `bc6b91e81e7c7bebd22db4e9fa0913b07db912de`. Итоговый HEAD и команды определяются ignored `qa/s2c/execution-ledger.json` / `final-verification.json`; документ не ссылается на собственный ещё не созданный commit hash.

## Статус и граница доказательств

Synthetic scope реализован и проверен; candidate готов к review с явными integration/vendor gates. До commit выполнены все именованные проверки ниже; после commit повторяется полный final pass с привязкой source/report/dist hashes к точному HEAD. Окончательное подтверждение — `qa/s2c/final-verification.json` со status PASS, а не перенесённые исторические результаты. Реальный Electron runtime, package и Canon hardware не запускались. `token-efficiency` skill запрещён root и всем агентам; не использовался.

| Карточка | Независимая реализация | Остающийся gate |
|---|---|---|
| NATIVE-001 | Request/operation identities, source-bound generation, admission gate, timeout retains ownership, cooperative cancellation, terminal exactly once | Actual Electron utility-process wiring smoke; native synchronous execution/cancellation не сертифицированы |
| NATIVE-002 | Immutable callback-time delivery context, unique transfer ID, explicit AMBIGUOUS/EXTERNAL, no timing-based guaranteed capture assignment, sticky recovery route | Matching vendor callback identity/quiescence/reference documentation и hardware RAW/JPEG matrix; полной native capture correlation нет |
| NATIVE-003 | Bounded producer-first coordinator, main application/registration/persist barriers, trailing-event accounting, forced kill UNKNOWN, bounded diagnostics | Vendor-backed native producer fence отсутствует; actual SDK-loaded shutdown остаётся UNKNOWN даже при source-zero teardown |
| NATIVE-005 | Bounded returned-code/exception observations, primary + subsequent cleanup failures, raw numeric codes, refcount distinction | Полная классификация кодов и модель-зависимые последствия UNKNOWN без matching headers/reference |

Это не hardware-certified или packaged correctness. Pure/mock и actual synthetic process/filesystem evidence имеют отдельные границы ниже.

## Request и operation lifetime

`electron/operation-lifecycle.cjs` используется обоими концами production RPC. Envelope содержит `generation`, индивидуальный `requestId`, отдельный `operationId`, монотонный `sequence`, `method`, исходный `sessionEpoch`. Native epoch после законного connect/disconnect возвращается отдельно; terminal echo продолжает идентифицировать исходный request. Epoch принимается main только из принятого RPC envelope или текущего status source; ignored/foreign/replayed reply не отравляет следующие requests.

Состояния: `ADMITTED → RUNNING → COMPLETED | FAILED | CANCELLED | UNKNOWN_TERMINATION`; timeout переводит оставшегося владельца в `CANCELLING`, unsupported cancellation — в `DRAINING`. Consumer Promise отклоняется один раз, но ownership остаётся до producer terminal. Cancel acknowledgement сам по себе не terminal. Handler terminal отправляется после его async `finally`; replay активного request не получает ложный terminal. History ограничена 64, active RPC — 128. Все обычные команды exclusive; event pump остаётся вне этой admission queue. `status`, `burstStop`, producer fence и finalization — отдельные safety paths.

Нативный синхронный вызов не объявляется cancellable. Cooperative checkpoints существуют у card import между файлами; отмена capture не выдаётся за остановку SDK. UNKNOWN закрывает обычный admission, но оставляет safety transport доступным. Explicit transport death закрывает поколение; forced kill не становится clean completion. Main сохраняет существующие legitimate `controlBusy`/`cameraIdle` guards и добавляет worker ownership к desktop/Remote busy. До 16 поколений worker удерживаются для полного учёта поздних сообщений; затем требуется restart приложения.

Серии, interval и burst теперь различают запрошенные действия и подтверждённые кадры. Quiet-window receipt — только завершение JS observation handler: `confirmation: UNVERIFIED`, `nativeQuiescence: UNKNOWN`, `shots: 0`, `files: []`, отдельный observed-transfer count. Это сохраняет обычную последовательность команд без выдуманного vendor proof. Same-route следующая съёмка остаётся compatibility behavior, требующим hardware gate; RAW/JPEG completeness не гарантируется. UI/Remote не публикуют такой receipt как полностью сохранённую съёмку.

## Transfer identity и сохранение

`transfer-context.cjs` замораживает route до deferred callback work: native session epoch, library session ID, destination, route revision, transfer ID, operation type, admission phase. При отсутствии SDK correlation key `operationId`/`captureId` всегда null; активный app intent сохраняется лишь как `observationOnly` hint. Последующий capture B не получает RAW A по quiet-window эвристике.

Без app intent transfer обозначается EXTERNAL; после capture history или route boundary — AMBIGUOUS. Любая смена meaningful session/destination без подтверждённого native quiescence переводит новые ambiguous callbacks в userData `unattributed-transfers`, с `sessionId: null`. Quarantine сохраняется и после логического epoch/reconnect: callback не приносит origin epoch. Первое установление route из пустого начального состояния — отдельный случай. Same-route deferred transfer использует уже замороженный destination. В библиотеке сохранённые записи доступны среди всех сессий / без сессии; связь с app capture не гарантируется.

`transfer-producer.cjs`: `ADMITTED → retained/deferred → ORIGINAL_COMMITTED | explicitly failed → drained`. Владеет retained ref до завершения injected download, включая thenable fake port; освобождает его один раз. Actual synchronous SDK path сохраняет исходный retain/callback-release/deferred-release порядок. Invalidated session/download/scheduling/ref failure не пропускается молча: bounded issue делает результат UNKNOWN. Сохранность native объекта после такого отказа без vendor evidence не обещается.

SDK ACK body не переставлялся: `download → EdsDownloadComplete → pointer/length → copy/write wx → photo`; `finally` по-прежнему cancel-if-not-complete и stream release. Известное окно ACK-before-durable-disk остаётся отдельным S3T/vendor gate. ABI layouts не менялись.

`transfer-consumer.cjs`: принимает файл от конкретного worker source даже после смены текущего worker; `accepted → registration pending → persisted registration acknowledgement → drained`. Применяется существующий S2A committer. Новый live record/event не предшествует durable registration ack. Transfer metadata добавлена в photo record; остальной S2A import/export/recovery контракт сохранён. Exact transport duplicate ограниченно дедуплицируется; повторный SDK callback получает отдельный transfer ID, файлы не отбрасываются по имени/указателю. Sequence gaps/reuse/collision, post-fence events и registration errors учитываются явно; drain с issue не даёт clean shutdown.

## Shutdown

`shutdown-coordinator.cjs` — pure injected state machine. Основной абсолютный бюджет 8000 ms; producer phase — первая половина, force reserve ≤250 ms внутри общего бюджета. Только UNKNOWN diagnostic получает отдельные ≤250 ms. Это deadline policy, а не обещание wall-clock responsiveness при блокировке native event loop/OS.

`STOP_NEW_ADMISSION → CANCELLING → DRAINING_PRODUCERS → DRAINING_CONSUMERS → PERSISTING → CLOSING_WORKER → CLOSED | UNKNOWN_TERMINATION`; при необходимости `FORCING_WORKER`, затем `RECORDING_DIAGNOSTIC`.

Main закрывает новые desktop/Remote команды, отменяет будущие series/interval steps, начинает закрытие Remote/watcher независимо и сразу запрашивает emergency burst release. Post-await checks не позволяют старому watch/remote-start handler открыть нового producer во время close. Уже admitted application tasks и worker operations входят в producer drain. Worker останавливает новые обычные RPC, дожидается admitted deferred downloads, останавливает pump и возвращает photo watermark. Main ждёт registration, derived tasks и final S2A persist barrier. После teardown/exit повторно проверяет trailing consumer/persistence и watermark.

Native callbacks могут обнаружиться в teardown; новый nonduplicate event после fence всегда issue, даже с меньшим/reused sequence. Ни один forced process kill не имеет proof CLOSED. Недоказанный/зависший producer, persist failure, потерянный sequence, raw native failure или unexpected exit дают UNKNOWN. Сохранённые originals не удаляются для rollback. Privacy-safe `lifecycle-recovery.json` содержит bounded IDs/states/counts/codes, без фото, destination, serial или raw exception message. Diagnostic write может сам не успеть/ошибиться; его failure остаётся в receipt. Автоматического восстановления/удаления файлов по этому diagnostic нет.

При ненулевом/throw teardown результате worker удерживает небезопасно освобождаемые зависимости до process termination, закрывает ordinary admission и не продолжает новый SDK load. Это консервативная failure policy, не новая классификация SDK code. Normal source-zero call order сохранён. Ошибка release после primary capture failure переводит ownership в UNKNOWN; primary observation остаётся первой. Timer/manual burst release throw не может позже тихо завершить capture как success.

## Допуск и именованные проверки

Никаких `npm test`, wildcard discovery, старых app/hardware harness, Electron setup/download, SDK/Koffi execution или реальных фотографий/profile. Dependencies скопированы как bytes из проверенного S2A node_modules, без npm/lifecycle/network; lock/dependency versions неизменны. Build/codec/Edge assets допускаются отдельно по фактическим SHA256; копия зависимостей сама по себе не PASS.

Общий runtime prefix: `NODE_OPTIONS=''`, `NODE_PATH=''`, `APERTROVE_SOURCE_COMMIT=<полный HEAD>`. T1/T2 JS — `node --no-addons --max-old-space-size=192`; fake child имеет heap128. Каждый entrypoint прочитан с полным import/execution closure. VM/guards являются reviewed-code allowlists, не OS sandbox.

| Entry / suffix | Уровень и доказательство |
|---|---|
| `tests/s2c/lifecycle.cjs --tier T1 --scope synthetic` | Fake clock/transport/SDK/ref ledger, operation identity/cancel/epoch, immutable transfer/consumer, shutdown/faults/observations, series receipts; closed pure production graph |
| `tests/s2c/worker-capture.cjs --tier T1 --scope synthetic` | Только выделенные source functions actual worker capture/fail/settle/stop в VM + JS SDK; manual/timer release failures, primary preservation, quiet UNVERIFIED, fallback order; полный worker не выполняется |
| `tests/s2c/transport.cjs --tier T2 --scope synthetic` | Exact fake Node child only, bounded IPC/controlled crash/hang/kill, no native fallback/network; current S2A importer/committer со synthetic filesystem и original hashes |
| `tests/s2c/fake-worker.cjs` | Не standalone test; допускается только exact bounded child configuration от transport runner |

Mandatory traces: JPEG A→quiet→B→RAW A; timeout A→late A→B; session boundary; destination change before deferred work; physical external event; duplicate; crash during transfer; partial pair; post-fence event; missing capture key. Проверяется отсутствие guaranteed capture identity, явный учёт файла/неизвестного результата и неизменность synthetic originals. Exact trace assertions, commands, exits и counts — в execution reports, не только в этом списке.

Regression pass на final candidate HEAD включает S1 bootstrap, security policy, S2A export/registration/recovery/filesystem/Sharp, storage, literal127 Remote loopback, Vite, actual built React в отдельно проверенном installed Edge, i18n и source preflight. Renderer добавляет draining busy + manual held-burst release + honest unconfirmed state; focal/services/dialogs всё ещё fixtures, не Electron IPC.

| Именованная проверка | Исполненный результат / ожидаемый exact final count |
|---|---:|
| S2C lifecycle T1 | 45 / 45, exit0 |
| Actual extracted worker capture T1 | 8 / 8, exit0 |
| S2C Node IPC + actual S2A registration T2 | 7 / 7, exit0; child exits0 / controlled23 / forcedSIGTERM; остаток0 |
| S2A protected export policy T1 | 40 / 40, exit0 |
| S2A registration T1 | 13 / 13, exit0 |
| S2A recovery T1 | 36 / 36, exit0 |
| S2A actual filesystem T2 | 44 / 44, exit0 |
| S2A Sharp codec T2 | 10 / 10, exit0 |
| S1 bootstrap T1 | 41 / 41, exit0 |
| S1.5 security policy T1 | 29 / 29, exit0 |
| Shared storage T2 | 19 / 19, exit0 |
| Remote literal127 HTTP/WS T2 | 14 checks, exit0 |
| Built React / installed Edge T2 | 10 groups, exit0 |
| Vite build | exit0 |
| i18n | 1638 keys, 0 errors, exit0 |
| Source preflight | 249 allowlisted files, exit0 |

Итого16 named commands. Точные flags/environment и exits каждой финальной команды — execution-ledger; для S2C приведены выше. Остальные commands: `tests/s2a/{export-policy,registration,recovery}.cjs --tier T1 --scope synthetic`, `tests/s2a/filesystem.cjs --tier T2 --scope synthetic`, `tests/s2a/codec.cjs --tier T2 --scope synthetic --allow-native-sharp`, `tests/t1-runner.cjs --tier T1 --scope synthetic tests/t1/library-schema.test.cjs tests/t1/library-bootstrap.test.cjs tests/t1/boot-state.test.cjs tests/t1/isolation.test.cjs`, `tests/t2/security-policy.cjs --tier T1 --scope synthetic`, `tests/t2/storage.cjs --tier T2 --scope synthetic`, `tests/t2/remote-loopback.cjs --allow-t2-loopback`, `node_modules/vite/bin/vite.js build`, `tests/t2/renderer.cjs`, `scripts/check-i18n.cjs`, `scripts/preflight.cjs`. Здесь brace notation только сокращает список документации; launcher выполняет каждый конкретный файл отдельно, без shell wildcard. Remote heap128, build heap512; codec/build без `--no-addons`, остальные — с ним и heap192. Sharp только exact0.35.5 assets; esbuild0.25.12/Rollup4.65.0 и signed installed Edge157.0.4341.60 сверены по SHA256. Dependencies скопированы, не устанавливались.

## Независимое ревью и участники

Фактические агенты: `s2c_rpc` — RPC helper/FSM; `s2c_transfer_vendor` — immutable route/vendor research/readiness и узкий UI; `s2c_shutdown` — coordinator/observations; `s2c_qa` — focused T1/T2; `s2c_reviewer` — независимое source/assertion/evidence review. Root владеет integration main/worker, transfer producer/consumer, extracted worker capture tests, renderer fixtures, execution и commits. Общие production файлы не редактировались параллельно разными владельцами.

Исправлены review findings: stale ordinary admission; post-fence smaller sequence; premature release async fake download; cross-epoch route reset; ignored-envelope epoch poisoning; unbounded generation retention; post-await watcher/Remote producer creation; early exited-worker false close; manual burst native throw followed by quiet false success. Итоговый clearance ограничен прочитанным source и исполненным synthetic scope.

Первый крупный QA file write завис и был прерван; readback подтвердил отсутствие partial file, после чего агент перешёл на bounded writes. Это не runtime failure и не PASS. Первый lifecycle admission отказал до тестов: missing pure транзитивная зависимость `camera-values → image-quality`; root прочитал её, добавил exact9th module и сохранил `lifecycle-attempt1-console.txt`. Следующий запуск45/45. Host/child bare-package deny regex исправлен source review до первого T2 запуска. Precommit reports/console сохраняются отдельно от final evidence; они честно имеют baseline HEAD + actual dirty-source hashes.

## Vendor unknowns, operational risks и следующий шаг

Matching `EDSDK.h`, `EDSDKTypes.h`, `EDSDKErrors.h` и API Programming Reference для используемого binary package не обнаружены в ограниченных известных SDK/install roots. Официальные Canon CAP/release overviews не заменяют matching contracts. Историческая DLL version/0 cameras не доказывает правильность ABI или callback/reference semantics. Никаких proprietary SDK downloads/loads.

Остаются UNKNOWN: callback identity/quiescence, model-specific RAW/JPEG cardinality/latency, event/COM pumping, complete/cancel durability, ref lifetime и code taxonomy. `EdsRetain`/`EdsRelease` returns — reference counts, не error codes. Loaded-SDK shutdown получает UNKNOWN, пока нет vendor proof, даже если все source calls вернули zero. Recovery routing после boundary намеренно консервативно; пользователь проверяет unassigned files. После unknown operation ordinary camera commands требуют restart/recovery, а не бесконечного ожидания или нового автоматического shutter.

Перед combined merge нужен отдельно разрешённый real Electron smoke с fail-closed fake provider, включая actual utilityProcess/IPC/startup/close и ASAR closure. Для release — clean Windows/package и отдельная Canon model/firmware/hardware matrix. S3T durable handoff остаётся gated; общие UX/performance улучшения могут ждать. Не требуется закрывать все 25 backlog cards для review PR. Кратчайшая последовательность и классификация BLOCKS MERGE / BLOCKS RELEASE / DEFERRED — `docs/INTEGRATION_READINESS.md`. Push, создание PR, merge и release здесь не выполняются.

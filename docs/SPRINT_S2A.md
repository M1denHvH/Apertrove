# Sprint S2A — protected exports, transactional registration, bounded recovery

Дата: 2026-11-19. Worktree: `%USERPROFILE%\Desktop\Apertrove-s2a`. Ветка: `feat/s2a-data-integrity`. Точная база: `4c198f7b8c98842342ada8fce6bc5f75adcd470f`.

## Executive status и provenance

Реализованы DATA-002 и узкий commit contract DATA-003, а также рабочий bounded slice DATA-006. Настоящие synthetic JPEG/metadata/preset exports и filesystem registration/recovery проверены. **VERIFIED COMPLETE для Electron/NTFS/power-loss/release не заявляется.**

Implementation commit: `903db6289cb4937fbddded853d7b5d11e1cbb0ff`. Точный итоговый HEAD, commits, commands/exits и повторные проверки после docs commit фиксируются в ignored `qa/s2a/execution-ledger.json`; `qa/s2a/final-verification.json` сверяет source/report/dist hashes, originals, прежние checkout и audit reports. Ниже приведены фактически полученные precommit результаты: их `sourceCommit` — исходный HEAD плюс изменённый execution tree, а `sourceHashes` фиксируют проверенные bytes. Они не переиспользуются как final-HEAD PASS. Две исходные EOL-разницы scripts не входят в реализацию.

## Production changes

| Файл | Контракт |
|---|---|
| `electron/protected-export.cjs` | Fresh registry, NEW-only export, exclusive handle, known-alias checks, active/incomplete output wait |
| `electron/export-service.cjs` | Общие настоящие JPEG/metadata/preset routes с injected dialog/codec ports и сохранением cancellation |
| `electron/library-commits.cjs` | Общая очередь persist/registration/export serialization, detached candidate, append после writer ack |
| `electron/photo-import.cjs` | Настоящий addFiles pipeline: committed counters/events, retained copies, verified retry hints |
| `electron/library-recovery.cjs`, `library-storage.cjs` | Validated primary/previous slots, bounded managed backup, strict ordinary writes и явный boot-only fallback |
| `electron/main.cjs`, `library.cjs` | Wiring общих сервисов; `renderEditedBuffer` вместо pathname JPEG export; codecs для cache сохраняют прежний путь |
| `src/main.jsx`, `src/PhotoMetadata.jsx`, locale JSON | Согласованные error/cancel/success UI paths и сообщения protected/incomplete export, retained import, degraded backup |

Main CSP и SEC-001/002/003 в этом спринте не заменяются новыми политиками. Camera worker, EDSDK/shutter/transfer ACK не входят в production scope.

## DATA-002: поддерживаемый export

Main строит registry заново из **всех** `store.photos[].path`, primary/previous library paths и userData directory. Три export routes используют один planner/writer и общую с library commits очередь. Проверяются lexical Windows case identity, canonical destination/known protected paths, существование destination и доступные file identities; эти проверки не объявляются универсальным NTFS proof.

Поддержан обычный **NEW output** в существующем regular folder. JPEG producer сначала возвращает реальные bytes через `renderEditedBuffer`, затем writer открывает destination с `wx`, пишет через тот же удерживаемый handle, проверяет видимую identity/size и ожидает close. Optional недоступный identity исходного несвязанного файла не выключает новый export: существующий destination всё равно отвергается exclusive creation. Registry перечитывается до создания и после reservation, поэтому late registration не игнорируется.

Существующий обычный exported artifact также не перезаписывается. Save dialog overwrite confirmation не является разрешением обойти registry: пользователь получает понятное сообщение выбрать **новое имя**. Это ограничение overwrite, а не отключение JPEG/JSON exports. Registered originals, другие originals, library/previous и protected userData никогда не являются разрешёнными export destinations.

| Route | Реальный положительный oracle | Cancel / failure |
|---|---|---|
| JPEG | Generated JPEG → actual Sharp pipeline → NEW файл; независимый SOF 32×24 и native decode результата | Cancel: null без producer/output. Codec/write/close error: reject, без success |
| Metadata | Actual metadata parser на generated original → пригодный NEW JSON с проверенными фактами | Cancel без parser/output; writer failure наблюдаем |
| Presets | NEW JSON `{version:1,presets:[...]}` с независимо проверенным содержимым | Cancel без producer/output; existing/protected destination отвергается |

Incomplete созданный output сохраняется для проверки; автоматического pathname unlink нет, поскольку ownership пути мог измениться. `outputRetained` и destination доходят до сообщения пользователю. В текущем процессе active writer блокирует importer через `waitForPath`; failed retained output не допускается как completed import. Сведения active/incomplete volatile: после restart требуется явная проверка retained files, durable incomplete-export journal не реализован.

## DATA-003: acknowledged registration и reconciliation

`persist`, `registerPhoto` и export serialization используют одну очередь. Snapshot создаётся **при начале queued job**, отделяется JSON copy и валидируется. Registration rechecks dedup внутри очереди, пишет candidate с staged record и только после writer acknowledgement добавляет этот record в live photos. Полный store/settings snapshot назад не устанавливается; unrelated edits во время await сохраняются своим последующим queued persist. Rejected job не отравляет tail.

`added` увеличивается и photo event публикуется после ack. На persist failure staged fingerprint не становится durable dedup, поздний unrelated persist не подхватывает failed record. Notification exception не отменяет уже подтверждённую регистрацию. Multi-file import возвращает committed added/skipped/errors; recoverable Sharp/exifr warnings по-прежнему дают record с `previewError`, fatal preparation throw — error без added.

Успешно скопированный original при build/index failure не удаляется; `stage`/`retainedPath` сохраняют понятный recovery путь. Volatile hints ограничены 256 entries и не являются index: повтор того же запроса проверяет SHA retained copy перед reuse. Потеря hint не удаляет файл. Camera-style `copy=false` сохраняет доставленные bytes и deduplicates по path+fingerprint; это не execution камеры.

**Restart policy:** orphan original остаётся вне index до явного reimport. Обычный `copy=true` всегда создаёт NEW managed copy, в том числе при выборе файла внутри active capture folder; старый retained source сохраняется. Это намеренно заменяет отвергнутую in-place reconciliation идею, чтобы явный import не мог присвоить произвольному alias существующий original. После commit новый record индексируется, следующий import пропускается по durable fingerprint. Автоматическое обнаружение/сканирование orphan originals и durable registration journal не реализованы.

Границы различаются: source read → exclusive original copy acknowledged → record staged → JSON primary replacement acknowledged → UI result/event. Последние не доказывают физическую power-loss durability. Другие старые mutators settings/presets/delete не превращены в общий transaction framework: сильный новый staging contract относится к registration; full-root rollback не добавлен.

## DATA-006: bounded generation policy

- Primary — authoritative role, если проходит schema/version gate. Previous не выбирается вместо него по timestamp; generation chronology и mtime не считаются доказательством более свежего состояния.
- Изменяющая strict ordinary запись сохраняет **точные raw bytes валидного прежнего primary** в одном `library.previous.json` до primary replacement. При migration это сохраняет исходную legacy generation, если backup rotation успешна; BOOT-only degradation ниже является явным исключением, и прежний valid raw primary тогда не гарантированно получает новую backup copy. После успешной primary rename нет fallible filesystem/notification работы, которая могла бы отклонить acknowledged registration.
- JSON candidate detached/validated до I/O. Sibling temp создаётся `wx`; write/close/check предшествуют rename. Late изменения slots проверяются по classification/SHA. Это detection известных изменений, не atomic OS compare-and-swap.
- Corrupt/unreadable primary сохраняется; future primary не downgrade. Missing primary при любом existing previous — RECOVERY_REQUIRED, а не пустая fresh library. Fresh возможен только при отсутствии обоих slots.
- Semantically unchanged validated v2 может boot/persist без rewrite/backup rotation, сохраняя raw formatting и unusable previous. Изменяющая ordinary запись при corrupt/future/unreadable previous либо backup I/O failure остаётся strict и отклоняется до primary commit.
- Только boot adapter явно передаёт `allowBackupDegradation:true`: при определённых backup failures допускается подтверждённый valid primary commit с warning, прежний recovery material не удаляется. Detected generation change и future primary не поглощаются. Warning не может отменить ack. NEW exports работают независимо от strict backup failure.
- Один managed previous slot не даёт unbounded backup generations. Failed/interrupted temps сохраняются и не продвигаются автоматически. При повторных faults такие forensic temps могут накапливаться; manual inspection/retention и OS crash durability остаются OPEN.

`inspectLibraryRecovery` даёт deterministic classifications и candidate information. **Automatic backup promotion, explicit restore UI и подтверждённое восстановление после power loss не реализованы.** Corrupt/future bytes не заменяются молча даже при valid previous.

## Реальные precommit executions

Перед каждым runner очищены NODE_OPTIONS/NODE_PATH, задан полный проверенный APERTROVE_SOURCE_COMMIT. Все входы именованные; default npm test/glob и Electron launch запрещены. Новые fixtures/raw reports находятся под `qa/s2a/`, повторные legacy runners также используют `qa/s1/` и `qa/integration/` **нового S2A worktree**; generated evidence не коммитится.

| Команда | Tier | PASS / FAIL | Exit |
|---|---|---|---|
| `node --no-addons --max-old-space-size=192 tests/s2a/export-policy.cjs --tier T1 --scope synthetic` | T1 VM/model | 40 / 0 | 0 |
| `node --no-addons --max-old-space-size=192 tests/s2a/registration.cjs --tier T1 --scope synthetic` | T1 VM/model | 13 / 0 | 0 |
| `node --no-addons --max-old-space-size=192 tests/s2a/recovery.cjs --tier T1 --scope synthetic` | T1 VM/model | 36 / 0 | 0 |
| `node --no-addons --max-old-space-size=192 tests/s2a/filesystem.cjs --tier T2 --scope synthetic` | T2 actual FS, non-codec producers | 44 / 0 | 0 |
| `node --max-old-space-size=192 tests/s2a/codec.cjs --tier T2 --scope synthetic --allow-native-sharp` | T2 actual Sharp, generated inputs | 10 / 0 | 0 |

Model results не доказывают physical writes; это отдельно обеспечено T2 held-handle/JSON read-back и codec outputs. Codec: 32×24 RGB, input/output ≤1 MiB, concurrency1/cache off, 30s wall, 192 MiB JS heap и 512 MiB sampled RSS budget. Фактические peakRSS/heap/resourceUsage сохранены в каждом report и final manifest; 50 ms sampling не заменяет OS-level tracing. Native allowlist — рассмотренный Sharp 0.35.5 addon/libvips dependency closure; Canon/Koffi/Electron/сеть/subprocess не разрешены. Native output path заменён bounded bytes → guarded filesystem, а не произвольной native pathname записью.

Filesystem suite: 30s total/3s per case, 180 fixture files; завершён с openHandles0 и сохранёнными fixtures. Codec также openHandles0. Symbolic-link/junction/hardlink cases выполнены в owned synthetic tree; Windows ACL permission failure был injected, не OS ACL certification.

### Физические originals SHA-256

| Fixture bytes | До и после |
|---|---|
| FS A | `7ccf574b5f0d3d4552afb502aa773eccbf5cd7854088dadbf302947f1c958e07` |
| FS B | `fccfca591f501ccf897f52976acb3e9c905942f4cf8c8ee3f19576bbf21b4480` |
| Generated JPEG A | `95e5e52a6ee7f808b6a4d1eb665ada2be7014f49b9dc0a2a9516101921fcdf2c` |
| Generated JPEG B | `b0bb2cb1a81df8919def0041e5024d4009b2703e7f5c6a6f5c8319eed9b7af30` |

Полные paths/hashes/traces — в `filesystem-results.json`, `codec-results.json` и final ledger. Model original hashes явно обозначены memory-only и не смешиваются с этой таблицей.

### Сохранённые неуспешные попытки

- `filesystem-attempt1-results.json`/console: 42 PASS, 1 FAIL, exit1 — отсутствующая fixture binding `previousPath`, затем исправлен runner и повторено 43/43. Дополнительный actual corrupt-primary + invalid-backup case довёл последующий успешный suite до 44/44. Это не production writer failure.
- `codec-attempt1-results.json`/console: 0 PASS, 1 FAIL, exit1 — reviewed exifr closure потребовал Node zlib, которого не было в allowlist. Sentinel не позволил выдать PASS; после review разрешён конкретный builtin и повторено 10/10. Это не blanket native permission.

Failed evidence сохранён, исторические результаты задним числом не переписываются. Approved npm preparation выполнялась с ignored lifecycle scripts и изолированными cache/config; postinstall/driver/native setup/Electron download не являются частью этих проверок.

## Regression и review ledger

| Область | Доказано текущими S2A executions | Граница проверки |
|---|---|---|
| NEW JPEG/metadata/preset export, cancel, originals/store, existing artifact | Actual shared routes и FS; actual synthetic codec/parser для positive outputs | Native Electron dialogs/UI runtime |
| Windows case/known aliases, race/late registry, partial write/close, two writers | Model + owned-tree actual FS; no original hash changes | Hostile NTFS namespace races, OS ACL/locked handles, arbitrary aliases |
| Registration counts/events/retry/partial batches/concurrent edit | Actual FS importer+writer и deterministic committer model | Actual camera worker delivery/late transfers/shutdown faults |
| Recovery valid/missing/corrupt/future/legacy/backup failure/interrupted temp | Classification+writer model и actual FS checkpoints | Restore UI/manual promotion execution, power-loss/crash/packaged recovery |
| S1 boot/legacy/Retry, React navigation/settings/all export UI paths | Повторные S1 T1 41 PASS, security VM 29 PASS, storage T2 19 PASS; actual React/Edge расширен до 9 групп PASS, включая missing-primary/backup recovery, boot-only degradation и metadata export rejection/retry UI | Actual Electron/preload/OS dialogs не заменяются browser fixture |
| Remote auth/protocol, Vite build, i18n, source packaging, SEC-001/002/003 | Повторный Remote 14 PASS, build exit0; i18n 1629 keys/0 errors, exit0; preflight exit0, 237 allowlisted public files | Полный source/command/result manifest связан с final HEAD; архив/package не создавался |

Реальные роли: export architecture, library transactions/model tests, recovery/durability, actual FS/native QA, отдельный Independent Reviewer и root integration owner. Production library/import helpers интегрировал root после передачи ownership; параллельной записи shared main не допускалось. Независимый reviewer прочитал финальные production/tests, reports и реальные JPEG/JSON outputs; material blockers для scoped local commits не осталось. Исправления review:

- Убрана in-place reconciliation: ordinary import сохраняет NEW managed copy semantics.
- Semantic no-op и только BOOT-only backup degradation сохраняют usable valid-primary boot/export; ordinary changing persists остаются strict.
- Recovery повторно закрывает тот же owned handle при transient close failure; model больше не скрывает открытый handle.
- Добавлен composed actual copy → committer → recovery writer → primary-rename failure → deterministic retry test.
- Добавлен явно требуемый actual-FS corrupt-primary + invalid-backup case с SHA обоих streams; renderer покрывает metadata rejection/retry/cancel без потери tags/pageerror.

Задержанное завершение metadata export после смены фото/unmount рассмотрено по исходнику, отдельный runtime PASS не заявляется. Положительные тесты используют реальные output bytes, actual partial-write rejection и независимо разобранные JPEG/JSON. Итоговые source hashes и provenance подтверждаются final manifest после commits.

## Open gates и следующий sprint

Actual Electron main/preload/OS dialogs, packaged/VM/T3, полные NTFS/ACL/aliases/hostile-concurrency гарантии, power-loss durability и любой Canon/EDSDK/WIA/hardware runtime остаются NOT RUN/OPEN. Main CSP не расширяется побочным изменением. Сохранение ordinary functionality подтверждено на объявленном synthetic scope; отсутствие всех продуктовых регрессий вне него не утверждается.

Рекомендуемый следующий roadmap sprint — **S2C: Ownership, cancellation и bounded shutdown**. Для него потребуются producer/consumer operation identity, cancel/drain acknowledgement, producer-first quit и bounded late-event synthetic scenarios; затрагиваемые SDK contracts требуют matching vendor evidence. Автоматический переход, camera calls или release здесь не разрешаются. Restore UI/temporary-material retention и Windows-specific durability должны иметь собственные проверяемые acceptance gates.

# Integration Candidate 01 — настоящий Electron, изолированный camera provider

Дата: 2026-11-19. Ветка: `feat/integration-candidate-01`; worktree: `%USERPROFILE%\Desktop\Apertrove-candidate`.

**Qualification contract:** точный candidate SHA и его статус определяются `qa/integration-candidate/final-verification.json`, `execution-ledger.json` и `independent-review.json`, а не самоописанием commit в этом документе. **MERGE-READY** относится только к SHA, для которого final manifest/ledger имеют PASS, все17 named commands завершились exit0 на тех же source bytes и независимый reviewer выдал clearance без unresolved blocking findings. Если хотя бы одного такого receipt нет или он не совпадает с candidate, статус — **REVIEW-READY BUT MERGE-BLOCKED**. Это правило не объявляет неисполненный final pass успешным и не разрешает release. Исторический precommit `sourceCommit` — baseline; фактически исполненные изменения определяются его source hashes, не одним этим полем.

## Состав и польза

| Этап | Изменение для пользователя / safety contract |
|---|---|
| S1 | Повреждённая или будущая library не заменяется пустой; migration/persistence предшествует READY; Recovery предлагает Retry/Close |
| S1.5/S2B | Общий boot/storage путь, исправленные ws/Vite floors, trusted frontend, deny-by-default permissions и ограниченный clipboard IPC |
| S2A | JPEG/metadata/preset exports только в NEW destination; originals/store защищены; photo added/event лишь после registration persistence ack; previous generation сохраняется ограниченно |
| S2C | Timeout сохраняет ownership; late replies не завершают новую operation; late RAW/JPEG не получают выдуманный capture ID; bounded shutdown и явный UNKNOWN |
| IC01 | Эти production routes исполняются вместе в настоящем Electron main/preload/renderer/utilityProcess; fake заменяет только hardware boundary, не приложение или library/export logic |

Это исходный combined candidate, а не публичный release. Canon/EDSDK behavior не сертифицируется.

## Git и сохраняемая история

Создан от точного S2C `77aedc4b514243c470b2c1fdbcca0a9d70b62418`. Исходный audit/main — `d7c9e02f09c89d70afdce72cd38ec99fadb05489`; восемь локальных S1→S2C commits линейно продолжают его: `7c1652a`, `03919f8`, `4c198f7`, `903db62`, `bc6b91e`, `619f254`, `c1a0e07`, `77aedc4`. IC01 code/tests зафиксированы локально в `fa27d957744d460fece170dd4cac1b15b02af2ef`. Полный IC01 commit list и final candidate SHA фиксирует final manifest; собственный commit hash намеренно не вписан в tracked документ, который входит в этот commit.

Прочитанные локальные `main` и cached `origin/main` указывают на `d7c9e02…`; fetch не выполнялся. Это проверка доступного target, а не утверждение о текущем удалённом GitHub main. Перед публикацией/merge повторяется ancestry/diff относительно разрешённого актуального target. Автоматического rebase/merge нет.

Пять прежних worktrees, исторический audit output и ignored QA evidence сохраняются. Два inherited EOL-only diff в `scripts/preflight.cjs` и `scripts/source-files.cjs` остаются unstaged и не входят в IC01 commits. Final verifier должен повторно подтвердить эти snapshots.

## Electron executable admission

Exact pin: **Electron45.3.2 / win32-x64**. Direct archive получен из official `electron/electron` GitHub release v45.3.2; npm lifecycle/install script не запускался. SHA проверен до extraction по official release asset digest, official SHASUMS256 exact line и embedded checksum locked npm package.

| Artifact | SHA256 / размер |
|---|---|
| `electron-v45.3.2-win32-x64.zip` | `cd1ab0d49c2f76838c0c9ff75afefb4d9d85ca59036691932bf35be8eceba98b`; 158318730 bytes |
| Извлечённый `electron.exe` | `7ae7a76540172dba12a731974dac752be374ca1c35b3d0833ce7db60a07c8a3d`; 250056704 bytes; PE AMD64 /0x8664 |

Проверены73 ZIP entries /374358378 uncompressed bytes: нет traversal, symlinks или case-insensitive duplicate paths; все73 извлечённых файла сверены с entries проверенного ZIP. Stock executable имеет **Authenticode NotSigned**. Trust основан на official HTTPS/checksum provenance, не на подписи Windows и не на signed binary attestation. Security settings, drivers и Canon installation не менялись; elevation не требовалась.

Источники и exact acquisition commands: `qa/integration-candidate/runtime/admission.json`, `acquisition.json`, `extraction.json`, SHASUMS и scripts рядом. Pre-launch admission исторически содержит `electronLaunched:false`; факт последующего запуска и `process.versions.electron === '45.3.2'` подтверждает отдельный smoke report.

## Fail-closed composition и реальный execution path

`electron/integration-composition.cjs` — main-only одноразовый порт. Его ставит trusted `tests/ic01/entry.cjs` до загрузки настоящего main; selector из renderer/LAN/environment отсутствует. Неизвестная конфигурация, alias/escape fixture, иной fake entrypoint и packaged mode отвергаются. Обычный production launch не выбирает fake автоматически; packaged build не получает test runner/provider files, а установка composition дополнительно запрещена через `app.isPackaged`.

Исполненный путь: reviewed host `tests/ic01/smoke.cjs` → exact verified `electron.exe` → trusted entry → настоящий `electron/main.cjs` → настоящий preload и built React. Camera utilityProcess запускает только `tests/ic01/fake-camera.cjs`, с исходным S2C RPC contract и deterministic synthetic events. Настоящий `camera-worker.cjs` не запускается. Inspector utilityProcess, напротив, через validated `inspector-entry.cjs` исполняет настоящий `shot-inspector-worker.cjs` с actual Sharp/exifr на generated files.

Защита: forbidden import/spawn/dlopen sentinels, fixture-only writes/native image inputs, trusted source/assets reads, alias checks, bounded dialogs и явные fault ports. Koffi/EDSDK/SDK discovery/flash/WIA/PTP недоступны; неизвестные fake methods не пересылаются настоящему provider. Node network и shell закрыты; Electron session requests ограничены trusted local files/assets; loopback разрешён только host automation Inspector/CDP path. Chromium helpers считаются отдельно от camera/Inspector utility workers. Нет `--no-sandbox`, `--disable-web-security`, широкой permission allowlist или произвольного dev URL.

Профили/userData/session storage и APPDATA/LOCALAPPDATA/TEMP перенаправлены внутрь текущей disposable fixture. Это **reviewed-code isolation, не OS sandbox**: Chromium/Windows internals и DLL loader не инструментированы как независимая kernel boundary. Sharp0.35.5 addon и dependency bytes допускаются отдельно по reviewed exact hashes.

## Фактически выполнено до final candidate commit

Последний precommit smoke: **20/20, exit0; 12 последовательных Electron applications; 35545 ms; 35 generated originals с неизменными before/after SHA**. Host limit: одна активная app, максимум14, suite240000 ms, case25000 ms. Все12 owned Electron parents завершились exit0. После запуска scoped OS census по exact runtime path показал0 surviving Electron processes.

| Slice | Actual integrated evidence |
|---|---|
| D1 | Cold onboarding; valid v2; supported legacy migration; corrupt JSON, invalid schema, future version и controlled read EACCES; repeated failure без overwrite; repair→Retry; Close из recovery |
| D2 | Семь actual IPC/permission/navigation/clipboard boundary checks: mainFrame success, foreign sender/subframe/unknown IPC refusal, permissions deny, blocked window/navigation, clipboard result path и Inspector boundaries |
| D3 | Настоящие import/registration/persistence, reload record, NEW JPEG через actual Sharp, parsed metadata/presets JSON, cancel каждой export route, protected-original collisions, controlled persist/writer EIO без false success |
| D4 | Actual utilityProcess discovery/status; ownership после timeout и late terminal; partial pair/late RAW-like event; session boundary quarantine; malformed event epoch refusal; cooperative cancellation checkpoint; crash/force UNKNOWN; close с pending producer/registration |
| D5 | Navigation, theme persistence, recovery focus, actual `focal-asset:` decode, error/cancel visibility, Inspector open/close/reopen с actual codec worker |

Последнее расширение Inspector reopen/telemetry уже выполнено: **два настоящих Inspector codec workers**, у каждого guard nativeLoads1 / openHandles0 / unexpected0. Parse-only source check11/11 exit0. Root визуально проверил4 screenshots: onboarding, recovery, Inspector и metadata error. Эти precommit результаты относятся только к сохранённым bytes; они не заменяют final pass после всех production/test edits и не сертифицируют полный UI/accessibility matrix.

Минимальная smoke-команда после admission: `node --no-addons --max-old-space-size=256 tests/ic01/smoke.cjs --tier T2 --scope synthetic --allow-electron-ic01`, при пустых NODE_OPTIONS/NODE_PATH и полном проверенном APERTROVE_SOURCE_COMMIT. Native Sharp загружается внутри отдельно допущенного Electron process; host Node `--no-addons` не называется запретом addons дочернего Electron.

## Небольшие integration fixes

1. Trusted unpackaged composition отделяет fake hardware provider от настоящего main без ослабления production provider.
2. Неизвестное worker event отвергается **до** обновления native epoch: malformed telemetry не отравляет следующую operation.
3. Main remote-link и Inspector clipboard routes возвращают/ожидают результат writer; deferred/rejected write не выдаётся преждевременно за success.
4. Inspector CSP разрешает `font-src 'self' data:` для bundled fonts; остальные его ограничения сохраняются. **SEC-004 main CSP остаётся OPEN**; production/development HMR compatibility и packaged matrix не объявляются выполненными.

Это не изменения Canon ABI, callback/reference semantics или порядка native download ACK.

## Завершение merge gate и оставшиеся ограничения

| Статус | Условие применения к конкретному candidate SHA |
|---|---|
| **MERGE-READY** | Final17 named commands на закоммиченном HEAD имеют exit0, source/report/dist/original hashes и cleanup проверены final manifest, независимый reviewer дал clearance для того же SHA |
| **REVIEW-READY BUT MERGE-BLOCKED** | Reviewable diff и meaningful real Electron evidence есть, но хотя бы одно из перечисленных exact-HEAD условий отсутствует, не прошло или относится к другим bytes |
| **RELEASE-BLOCKED** | Clean Windows/package/ASAR/installer, Canon model/firmware matrix, matching ABI/callback/ref/quiescence и DATA-005 ACK durability; никакого hardware/power-loss certification здесь нет |
| **DEFERRED** | Дополнительный UX/accessibility/high-DPI/model coverage и measurement-first performance/cache work; SEC-004 остаётся явным отдельным security follow-up без speculative CSP rewrite в этом milestone |

Acceptance требует один coherent pass из17 named commands: S2C lifecycle/extracted-capture/Node-transport, S1 bootstrap, security policy, S2A export/registration/recovery/filesystem/codec, shared storage, Remote loopback, Vite, React/Edge, i18n, preflight и IC01 real Electron smoke. Это критерий, а фактические команды, exits, времена и counts читаются из execution ledger и reports. Final manifest связывает их с commit, проверяет source/report/dist/native-asset hashes, synthetic negative/original bytes, process/handle/socket cleanup, прежние worktrees и исключение только двух inherited EOL diff. Independent review связывает clearance с тем же candidate. Старые PASS не переносятся на новые bytes.

После подтверждения qualification contract следующий конкретный шаг — отдельная авторизация на push/open review PR с exact SHA из final manifest и текстом `docs/PR_DRAFT.md`. Перед фактическим merge остаются human review approval, проверка актуального разрешённого target и отсутствие новых изменений после final pass; наличие MERGE-READY receipt не выполняет эти действия автоматически. Закрывать все25 backlog cards не требуется. Если combined lifecycle gate не закрыт, independently reviewable storage/security slice — commits S1→S2A до `bc6b91e`; S2C/IC01 нельзя молча удалять или переписывать ради зелёного статуса. Push, PR creation, merge и release данным документом не выполняются.

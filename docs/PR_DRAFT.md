# Предлагаемый первый review PR

**Title:** Protect library integrity and verify isolated Electron integration

**Conditional final qualification:** candidate SHA, локальные commits и фактические результаты берутся из ignored `qa/integration-candidate/final-verification.json`, `execution-ledger.json` и `independent-review.json`. Этот PR scope квалифицируется как **MERGE-READY** только при PASS final manifest/ledger, всех17 named commands с exit0 и independent clearance без unresolved blocking findings для одного и того же SHA/source bytes. Иначе он **REVIEW-READY BUT MERGE-BLOCKED**. Исторический precommit PASS ниже сам по себе не закрывает это условие. Push/open PR, human merge approval и release не выполняются этим draft и требуют своих отдельных решений.

## Описание для PR

PR защищает существующую библиотеку от destructive startup/recovery paths, предотвращает экспорт поверх originals/store и связывает photo registration с persistence acknowledgement. Он также сохраняет ownership camera operations после consumer timeout: поздняя работа не выдаётся за безопасно завершённую операцию, а неоднозначные transfer events не присваиваются следующему capture по таймеру.

Integration Candidate01 впервые исполняет эти production components вместе в настоящем Electron45.3.2 main/preload/renderer/utilityProcess. Trusted unpackaged launcher подставляет только fail-closed fake hardware provider; application boot, storage, codecs, exports, IPC validation и Inspector остаются настоящими. Canon DLL/EDSDK/WIA/PTP/реальные camera actions в этой проверке недоступны.

Пользователь получает:

- Recovery с явным Retry/Close вместо потери существующей library при corrupt/future/unreadable store.
- NEW-only JPEG/metadata/preset exports и сохранённые originals при collision/cancel/failure.
- Import success только после подтверждённой записи регистрации; failed retained files не удаляются для rollback.
- Честные busy/draining/UNKNOWN и UNVERIFIED capture states; доступный emergency burst release и ограниченное завершение приложения.
- Проверенные вместе desktop navigation/settings, `focal-asset:` previews, Inspector и основные IPC boundaries.

## Что входит в diff

| Slice | Содержание |
|---|---|
| S1 | Schema/version/fatal-UTF8 gates, detached migration, persist-before-READY, Recovery UI и pure tests |
| S1.5/S2B | Shared boot/storage, ws8.23.0/Vite6.4.6 floors, trusted frontend, deny permissions, ограниченный clipboard IPC, Inspector registration rollback |
| S2A | Protected NEW-only exports, held output handles, transactional registration, retained-copy retry, bounded previous-generation recovery |
| S2C | Request/operation/session identities; timeout/cancel/drain lifetime; immutable ambiguous/external routing; producer-first bounded shutdown; native-result observations |
| IC01 | Main-only single-use integration composition; exact fake utility provider; real Electron smoke; malformed worker event whitelist до epoch mutation; clipboard Promise propagation; focused Inspector font CSP compatibility |

Нет Canon ABI/ACK/reference rewrite, dependency upgrade, UI redesign, нового camera feature или release/package workflow. Test/provider selectors не доступны из renderer/LAN/environment; packaged composition отвергается. Изменение Inspector `font-src 'self' data:` не называется закрытием **SEC-004 main CSP**, который остаётся OPEN.

## Git scope и target

Source baseline: `77aedc4b514243c470b2c1fdbcca0a9d70b62418`; branch: `feat/integration-candidate-01`. Combined S1→S2C history содержит8 commits после audited `d7c9e02f09c89d70afdce72cd38ec99fadb05489`. IC01 code/tests commit: `fa27d957744d460fece170dd4cac1b15b02af2ef`; exact полный IC01 commit list/final candidate SHA читатель получает из final manifest. Этот tracked текст входит в candidate и потому не содержит self-referential собственного commit SHA.

Прочитанные локальные `main` и cached `origin/main` — `d7c9e02…`; это доступная local target history, без fetch и без заявления о remote freshness. Lineage линейна; перед merge повторяется сравнение с актуальным разрешённым target. Divergence потребует отдельного review безопасного интеграционного пути, а не автоматического rebase/merge/force.

Пять предыдущих worktrees и historical audit/QA остаются сохранены. Два inherited EOL-only script diff не входят в commits. Raw logs, профили, executable/archive, generated images и абсолютные персональные пути остаются в ignored QA, не в PR.

## Проверка и evidence

**Executed precommit:** real Electron smoke20/20, exit0; 12 последовательных apps,35545 ms;35 generated originals сохранили SHA. Семь D2 boundary probes исполнили actual IPC/permission/navigation/clipboard paths. Последнее расширение повторно открыло Inspector и исполнило2 настоящих codec utility workers; у каждого nativeLoads1 / openHandles0 / unexpected0. Все12 parents завершились exit0; scoped OS census после smoke нашёл0 runtime-owned Electron processes. Parse-only11/11 exit0.

Покрыты actual cold/valid/legacy bootstrap; corrupt/schema/future/controlled EACCES, repair/Retry/Close; persisted import и reload; JPEG/JSON exports/cancel/collision; controlled writer/persist EIO; UI navigation/theme/focal-asset/errors; timeout/late events/cancellation/crash/force/UNKNOWN и close с pending producer/consumer. Synthetic RAW-like event проверяет identity/routing, а не RAW codec/model behavior.

Executable: official Electron45.3.2 win32-x64. ZIP SHA256 `cd1ab0d49c2f76838c0c9ff75afefb4d9d85ca59036691932bf35be8eceba98b`; executable SHA256 `7ae7a76540172dba12a731974dac752be374ca1c35b3d0833ce7db60a07c8a3d`. Archive checksum подтверждён official API/SHASUMS и locked embedded checksum до extraction; все73 extracted files сверены. **Stock binary unsigned / Authenticode NotSigned**; signed Windows binary trust не заявляется. Installer/npm lifecycle и elevation не использовались.

Evidence находится в ignored `qa/integration-candidate/`: runtime admission/manifests, smoke results/source hashes и сохранённые failures/attempts. Precommit `sourceCommit` указывает baseline вместе с hashes реально выполненных dirty bytes; он не является final candidate proof. Последняя source change требует нового affected check, а final status — coherent pass на точном закоммиченном HEAD.

Минимальная named smoke-команда:

```text
node --no-addons --max-old-space-size=256 tests/ic01/smoke.cjs --tier T2 --scope synthetic --allow-electron-ic01
```

NODE_OPTIONS/NODE_PATH пустые; APERTROVE_SOURCE_COMMIT — полный проверенный HEAD. Этот entrypoint не допускает default application launch или замену fake на real provider. Electron может загружать только отдельно допущенный Sharp addon; host Node `--no-addons` не подменяет его собственный guard. Arbitrary npm test/globs/legacy hardware harness не выполняются.

## Validation receipts и условия перед merge

| Receipt / источник | Что должно подтверждаться |
|---|---|
| Runtime admission/manifests | Exact official pinned archive checksum до extraction, executable hash/version, раскрытый NotSigned; отсутствие installer/elevation/security-disable действий |
| Исторический precommit smoke |20/20,35 unchanged originals и actual main/preload/renderer/utilityProcess, Inspector reopen/codec telemetry; это evidence сохранённых bytes, а не замена final receipt |
| `execution-ledger.json` |17 final named commands на закоммиченном candidate: S1/security/S2A/S2C/storage/Remote/React/Vite/i18n/preflight + IC01; каждая exit0 и привязана к тому же полному candidate SHA |
| `final-verification.json` | PASS для exact HEAD; source/report/dist/native-asset hashes, negative/original bytes, process/handle/socket cleanup,5 прежних worktrees и только2 inherited EOL diff подтверждены |
| `independent-review.json` | Combined final diff/evidence проверены; scope/clearance относятся к тому же SHA; material unresolved merge blockers отсутствуют |
| Human merge decision | Перед фактическим merge всё ещё требуется актуальный разрешённый target, review approval и проверка отсутствия новых изменений после final pass |

Counts/commands этой таблицы — acceptance contract; фактические exits, counts и SHA фиксируют названные receipts. Таблица не ставит зелёный результат вместо отсутствующего отчёта и не требует нового doc commit после успешного final pass.

## Что блокирует что

| Статус | Критерий |
|---|---|
| **MERGE-READY** | Exact candidate удовлетворяет всем final receipt conditions выше; это readiness scope для review/merge, а не авторизация publish/release |
| **REVIEW-READY BUT MERGE-BLOCKED** | Reviewable scope есть, но хотя бы один required exact-HEAD receipt отсутствует, имеет failure или относится к другим source bytes |
| **RELEASE-BLOCKED** | T3 clean-Windows/package/ASAR/install, Canon model/firmware/hardware matrix, matching native ABI/ref/correlation/quiescence и DATA-005 durable camera handoff; power-loss durability не доказана |
| **DEFERRED** | Дополнительные UI/accessibility/model capabilities и измеряемые performance/cache improvements; SEC-004 main CSP — явный отдельный security follow-up, не скрытый PASS |

Синтетические CLOSED/fence результаты не сертифицируют EDSDK; loaded-SDK shutdown остаётся UNKNOWN без vendor proof. Quiet-window не гарантирует полную RAW/JPEG-пару. Ambiguous files после session/destination boundary остаются recoverable/unassigned, а не автоматически относятся к следующему capture. Перенаправленные profiles и code sentinels не являются Windows OS sandbox.

Если combined S2C/IC01 gate останется незакрытым, smaller independently reviewable storage/security slice — S1→S2A, до `bc6b91e`, с его отдельным validation scope. Это вариант reviewer plan: lifecycle commits нельзя молча удалить, cherry-pick/rewrite или считать проверенными без их собственного gate. Закрытие всех25 исторических backlog cards для review PR не требуется.

## Rollback strategy

До публикации сохранить exact reviewed commit/digests и совместимые backup generations store. При IC01 regression остановить rollout; подготовить reviewable `git revert` только затронутых focused commits, без destructive reset/clean и удаления worktrees. Не отключать существующие schema/export/registration guards ради восстановления startup.

Executable/source rollback не означает автоматический downgrade library. Future-version store по-прежнему требует отказа от записи; восстановление previous generation возможно только явно после проверки копии. Originals и retained failed outputs сохраняются для разбора, не удаляются cleanup-скриптом. Если проблема требует ABI/ACK/reference change, capability остаётся vendor-gated до matching evidence, а не исправляется предположением.

**Следующее действие после подтверждения qualification:** отдельная авторизация на push/open review PR с exact candidate SHA и фактическим validation summary из final receipts. Вставлять self-referential SHA в этот tracked draft или создавать новый doc commit ради уже записанных результатов не требуется. Перед фактическим merge сохраняются human approval и актуальная target проверка. Этот документ ничего не пушит, не создаёт PR и не запускает release.

# Sprint S1 — safe bootstrap и library integrity

Дата: 2026-11-19. Scope: QA-001, DATA-004, DATA-001, UI-003; ARCH-001 только необходимый seam.

## Status

**S1 implementation + разрешённые pure/mock regressions: PASS. Полная runtime verification: NOT RUN.**

Baseline d7c9e02f09c89d70afdce72cd38ec99fadb05489. Implementation branch feat/s1-safe-bootstrap в отдельном Apertrove-s1 worktree. Основной Apertrove-clean и audit-output не редактировались. Исходные EOL differences scripts/preflight.cjs/source-files.cjs не исправлялись и не входят в S1 commit.

## Production contracts

- library-schema.cjs: versionless legacy трактуется как v1; numeric1/2 поддержаны; целая future version выдаёт UNSUPPORTED_VERSION до mutation/write. Неверные root/version/container/record shapes отклоняются.
- photos array и object settings обязательны; sessions/presets при отсутствии дополняются пустыми arrays. Не требуются UUID/24hex IDs и generated photo metadata/thumbs/edits/rating. Minimal source-backed legacy fixtures поддержаны.
- Unknown root/record/top-level settings fields сохраняются detached copy. Known composition/workspace/onboarding normalizers остаются прежними projections известных nested settings; S1 не обещает сохранение arbitrary nested extensions этих normalizers.
- Dangling active sessionId нормализуется в null старой migration; photo references и stale presetQueue IDs не удаляются. Missing photo name выводится из basename на detached bootstrap copy; existing migrateSessions по-прежнему не меняет photo records.
- library-bootstrap.cjs: MISSING/ENOENT — единственный fresh path; VALID проходит detached prepare + повторную validation + commit; CORRUPT/UNREADABLE/UNSUPPORTED_VERSION/failed migration не вызывают writer.
- Failed persist не публикует READY. Explicit retry перечитывает источник; после READY boot — getter того же committed root, без повторной migration/IO поверх текущих app edits.
- library-text.cjs: fatal UTF-8 decode. Повреждённые bytes не превращаются молча в replacement characters перед write-back.
- Legacy profile probe: только ENOENT разрешает переключение на новый default profile; другие ошибки оставляют legacy path для явного loader failure.
- Ordinary persist gated до ready; staging commit использует отдельный writer. Recovery close не сохраняет fallback. Dispose после close не публикует READY/не запускает services. Уже начатый physical atomic write невозможно синхронно отменить этим pure contract.
- Main window/boot IPC создаются без успешного store. До готовности разрешены только boot/window; sender/mainFrame checks сохранены.
- Success publicState сохраняет прежнюю форму плюс bootFailure:null после spread; unknown persisted ok:false/bootFailure fields не могут подменить transport discriminator. Failure envelope содержит только kind и locale, без raw path/stack/library bytes.
- Worker/Remote/Inspector создаются после принятой библиотеки; sync initialization guards не дублируют уже присвоенные owners. Необратимые внутренние side effects частично упавшего конструктора остаются T2 gate.
- Renderer показывает loading/failed/retrying/ready; ошибка находится вне app shell; Retry явный, без auto-loop/reset, Close доступен во frameless recovery view. RU/EN keys, role alert/status, focus heading и keyboard-ready guard добавлены.
- safeName вынесен без изменения policy; sessions migration больше не импортирует Sharp. Новый helper включён в asarUnpack вслед за library.cjs.

ExportPhoto/exportMetadata/exportPresets handlers, camera-worker/EDSDK/shutter/transfer code и dependency versions **не изменялись**. DATA002/005 и S2A/B/C не реализованы.

## Реальные субагенты и review

- Agent A s1_qa: все56 baseline test entrypoints, transitive imports, isolation bypasses; два pre-exec review closure и delta.
- Agent B s1_storage: typed load/write boundary, v1/v2/versionless compatibility и startup callers.
- Agent C s1_boot: actual backend retry, hook ordering, locale fallback, accessible recovery view.
- Agent D s1_reviewer: независимый diff/assertion review. Найдены и исправлены profile-probe fallback, malformed response/locale, consumer schema types, UTF-8 replacement и unpacked helper dependency.
- Agent E s1_security_research: SEC001 read-only advisory/lock/reachability и будущие gates. Dependencies не менялись.

Root единолично интегрировал общие файлы. Существенных unresolved review blockers в S1 scope нет. VM не называется OS sandbox; native call count не выдаётся за OS instrumentation.

## Test results

Фактически выполнено: **41 PASS / 0 FAIL / 0 SKIP**, process exit0. Это actual pure/mock tests, а не source-review PASS. Из них schema6, bootstrap/profile/encoding24, UI pure6, isolation5.

Перед выполнением прочитаны runner, все четыре entrypoint, helpers, actual production closure и обе locale JSON. Полный literal graph проверяется также runner до исполнения. NODE_OPTIONS/NODE_PATH очищены перед запуском, после команды прежнее shell environment восстановлено.

Фактическое ядро команды:

```text
node --no-addons tests/t1-runner.cjs --tier T1 --scope synthetic tests/t1/library-schema.test.cjs tests/t1/library-bootstrap.test.cjs tests/t1/boot-state.test.cjs tests/t1/isolation.test.cjs
```

PowerShell wrapper: сохранить NODE_OPTIONS/NODE_PATH, Remove-Item этих Env entries; выполнить указанную команду через установленный Node, stderr/stdout записать Tee-Object в qa/s1/t1-console.txt; сохранить LASTEXITCODE до других native commands; восстановить Env в finally; вернуть сохранённый exit.

Три отдельные проверки CLI отказа:

| Invocation | Actual exit | Expected |
|---|---:|---|
| runner без tier/scope/entry | 2 | T1_SCOPE_DENIED |
| --tier T1 --scope synthetic tests/hardware.cjs | 2 | T1_ENTRYPOINT_DENIED; hardware script **не читался и не исполнялся runner** |
| --tier T1 --scope production tests/t1/isolation.test.cjs | 2 | T1_SCOPE_DENIED |

Aggregate assertion wrapper этих отказов: exit0. Все14 forbidden import probes получили T1_IMPORT_DENIED. Никакой MODULE_NOT_FOUND не засчитан как успешная изоляция.

Synthetic original: текстовые bytes fixture, SHA256 **da381ef36d441db6211d2cfe7b27c94e031831bcdf4c579e27d1f3003a0faec6**. Негативные load cases проверяют zero writes и неизменные hashes; failed persist различает attempted writer call и durable commit. Все storage files — memory Map, не настоящие фотографии/папки.

Локальные ignored evidence: qa/s1/t1-results.json, t1-console.txt, invocation-results.json, final-verification.json. t1-results содержит source hashes всех16 reviewed closure modules/data, graph, каждое имя/assertion outcome и blocked imports. Эти generated local files не входят в release/source commit.

## Acceptance matrix

| Критерий | Evidence / status |
|---|---|
| Explicit schema/version contract, future guard | PASS T1 + source review |
| Valid v1/v2/versionless / minimal records | PASS T1 fixtures |
| First-run ENOENT | PASS T1; реальная OS first-run T2 NOT RUN |
| Corrupt/empty/truncated/invalid schema | PASS T1 zero writer/hash assertions |
| EACCES/EIO/unexpected read failures | PASS T1 injected ports; Windows ACL T3 NOT RUN |
| Invalid UTF-8 | PASS T1 actual synthetic byte decoder |
| Failed migration | PASS T1 detached mutation/invalid-output, zero writer |
| Failed persist / explicit retry / repeated failure | PASS T1; physical atomic rename/disk failure T2/T3 NOT RUN |
| Concurrent retry / ready getter / close-dispose | PASS T1; real Electron close/IPC T2 NOT RUN |
| UI rejection/retrying/success/no-reset/locale | PASS pure controller; actual React render/focus T2 NOT RUN |
| Unknown entry/tier/scope/import/path rejection | PASS T1 + three actual CLI refusals |
| Independent code review | PASS source/closure review, blockers исправлены |
| Exports/native workflows not disabled | Source diff: handlers unchanged; functional T2/H NOT RUN |

## T0 checks и incidents

git diff --check — exit0. Changed CJS/JS files и closure прошли node --check; package/lock/locale JSON parse успешны. JSX compiler/build check не выполнялся: dependencies не устанавливались. Сам JSX прочитан root и независимым reviewer.

Первый git diff --cached --check после staging новых docs вернул exit2 из-за шести Markdown hard-break trailing spaces в TIERS.md. Пробелы заменены обычными абзацами; staged check повторён перед commit. Это formatting check, не T1 test failure; исполняемый test closure не менялся.

Worktree creation/readback — exit0; hooks inspection: core.hooksPath и commit.gpgSign unset (git config exit1 означает отсутствие значения), в hooks только *.sample. Один initial discovery batch завершился exit1 из-за отсутствия AGENTS/ancestor file, не source failure. Первая запись tests не создала parent directory из-за sandbox; Test-Path подтвердил отсутствие, каталог создан разрешённой командой и запись выполнена. Optional workspace-dependency discovery API оказался недоступен; установка/обход не предпринимались.

## Open gates и regression risks

**T2 NOT RUN:** реальный React render/accessibility tree/focus; Electron IPC, service partial-constructor/retry, cold/warm startup/onboarding, ordinary valid profile, actual Sharp/import/export, generic loadJSON runtime и packaged worker resolution.

**T3 NOT RUN:** Windows permissions/locked files/aliases, real atomic write/power-loss behavior, high DPI/Windows10/11 package.

**H/vendor NOT RUN:** Canon SDK/COM/WIA, discovery/connect/focus/EVF/shutter/transfers, ABI/reference contracts. S1 не меняет их bindings.

Основной риск — orchestration startup/legacy compatibility вне synthetic matrix. Поэтому отсутствие destructive source path не называется полной runtime certification.

## Next sprint

Сначала отдельное разрешение T2 mock-app bootstrap/normal-workflow regression, без Canon. Затем приоритетная независимая S2B lane для SEC001 ws patch: effective8.22.0 affected GHSA-37g9-w4hg-h9qr, patched8.23.0. Минимальный dependency/lock diff и bounded standalone loopback tests без Electron/SDK; не отключать Remote под видом fix. S2A protected exports/persistence — отдельный следующий блок после validation этих S1 seams. В данной сессии S2 production implementation не выполнялась.

Local feature commit и финальный Git status приведены в финальном сообщении и ignored qa/s1/final-verification.json. Push/merge/rebase/reset/clean не выполнялись.

## S1 files

Production: electron/library-schema.cjs; electron/library-bootstrap.cjs; electron/library-text.cjs; electron/photo-name.cjs; electron/boot-state.js; electron/library.cjs; electron/sessions.cjs; electron/main.cjs; electron/i18n/locales/en-US.json; electron/i18n/locales/ru-RU.json; src/main.jsx; src/interface.css; package.json (только unpack helper).

Tests: tests/t1-runner.cjs; tests/t1/policy.cjs; tests/t1/fixtures.cjs; tests/t1/library-schema.test.cjs; tests/t1/library-bootstrap.test.cjs; tests/t1/boot-state.test.cjs; tests/t1/isolation.test.cjs.

Docs: tests/TIERS.md; docs/SPRINT_S1.md. Итого22 S1 files. Два исходных EOL modifications не включены.

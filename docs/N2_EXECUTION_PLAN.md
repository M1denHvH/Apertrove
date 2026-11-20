# N2 — one authorized lifecycle experiment

Native lifecycle: NOT RUN. Этот документ не является разрешением запустить Canon или Koffi. Все актуальные условия и evidence ledger — N2_READINESS.md.

## Pre-execution admission

1. Использовать точный PSE EDSDK x64 SHA 35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627. Никаких альтернатив и повторов.
2. Schema 2 manifest pins Node, 2.16.3 addon, весь sibling DLL set, System32 reviewed files, reference, исполняемые sources, dependency/initialization/test evidence.
3. Vendor review остаётся VERIFIED_LIFECYCLE_SUBSET, не Canon package mapping. Init и terminate без аргументов; terminate только при init=0.
4. Dependency decision — STATIC_PATHS_REVIEWED, dynamicObservation=NOT_RUN. Safety decision — INITIALIZATION_PLAN_REVIEWED, runtimeObservation=NOT_RUN, WINDOWS_JOB_KILL_ON_CLOSE_TESTED containment. Runtime evidence не требуется выдумывать до первого вызова.
5. Сначала addon-free dry-run. ready:true означает только предварительную техническую готовность; nativeLoaded:false и runtimeObservations NOT_RUN обязательны.
6. Человек подтверждает applicable Canon rights, закрывает PSE/EOS Utility/Canon clients и физически отключает Canon USB/сетевые камеры. Никакой software flag не доказывает физическое состояние.
7. Получить отдельное явное разрешение на один init-only cycle. Если license или containment blocker не решён, остановиться до native load.

## Sources

prepare.cjs генерирует unqualified unique manifest под ignored qa/native-n2-admission/. Старые N1/N1.5 manifests не редактировать и не переиспользовать. После любых source/evidence/binary изменений сгенерировать новый.

manifest.cjs выполняет только reads/hash/PE parsing. run.cjs --dry-run не запускает процессы и не загружает addon. run.cjs --execute создаёт только один worker после preflight. worker.cjs не является самостоятельным SDK тестом и не включён в npm/CI scripts.

job-control.cjs, supervisor-host.cjs, job-supervisor.ps1 и supervised-process.cjs реализуют отдельную bounded Windows Job Object supervision. observe-control.cjs, observe-n2.ps1, observation-review.cjs собирают и классифицируют passive snapshots.

## Контроль и пределы

Отдельный detached addon-free Node host живёт независимо от controller. Встроенный PowerShell supervisor создаёт unnamed non-inherited KILL_ON_JOB_CLOSE job, без breakaway. Проверяет исходного ребёнка по pid, parent, image, nonce marker, creation time и retained handle. До подтверждённого job assignment manifest не передаётся. До admission worker ждёт; disconnect и 15s admission timeout завершают его без native load.

Before snapshot проверяет identity/signature/DACL и отсутствие видимых Canon clients. Observer стартует до native delivery. 15s lifecycle watchdog работает вне native worker. Controller запрашивает exact-root termination, затем при необходимости whole-job termination. Каждое ожидание bounded, проверки монотонные. Root close/signaled handle и job active0 проверяются раздельно.

При потере controller supervisor видит EOF и самостоятельно завершает job. При смерти supervisor последний job handle закрывается, что запускает Windows kill-on-close. При неполученной exit-confirmation результат UNKNOWN. Подтверждённый handoff передаёт cleanup отдельному supervisor с явным deadline, а не скрывает orphan. Hard deadline supervisor 60s и host timer 65s с 500ms fallback и не более 750ms output flush не превращаются в доказательство kernel-level cleanup.

Natural exit0, ненулевой exit, crash, timeout, forced kill и UNKNOWN различаются. SOURCE_ZERO_CYCLE требует raw init0/terminate0, source cleanup receipt, natural clean process exit и подтверждённое пустое Job дерево. Descendants, unexpected module location, observation gaps/effects исключают чистый результат. Никакой retry или второй DLL.

## Наблюдение

Before/After: Windows build/arch, target runtime SHA/version/Authenticode/DACL fingerprints, relevant Canon processes/services, passive camera-class PnP inventory и targeted endpoint snapshots. During: root/Job PID module list, thread/handle counts и process start times. PID file содержит root и observed job members; retained root handle защищает управление от PID reuse, а snapshot startTime не следует путать с kernel handle proof.

Queries/output/time budgets bounded, failures/truncation явные. Отсутствие sampled delta не доказывает отсутствия USB/RPC/network/device effects. Job не ограничивает уже существующие services или привилегированные действия native code вне процесса. Любой residual risk включается в отдельное согласие.

## Future command

Выполнять только после закрытия технических и legal условий и отдельного явного разрешения человека:

    node --no-addons --max-old-space-size=192 tests/native-n1/run.cjs --execute --manifest $manifest --authorize-native-n2 --camera-disconnected --canon-apps-closed --acknowledge-canon-terms

$manifest должен быть абсолютным путём свежего schema 2 файла. Флаги записывают подтверждения, но не подменяют реальное разрешение или Canon лицензию. В этом milestone execute не выполняется.

## Stop protocol

Hash/source/DACL/signature/process baseline mismatch — отказ до native admission. Неуверенная загрузка, nonzero init/terminate, crash, timeout, helper/descendant, невозможность чтения обязательных наблюдений — сохранить output и остановиться.

UNKNOWN сохраняет exact PID, supervisor/host PID, job log, requests/return codes и deadline handoff. Проверить последний supervisor final и retained process exit facts; не запускать второй attempt и не удалять evidence. Если OS termination остаётся unconfirmed, не сообщать clean cleanup и не убивать другие процессы по совпавшему старому PID.

## Follow-up before H1

Не повторять init или fallback внутри production camera worker. Исправление production lifecycle должно сохранить S2C ownership, native uncertainty, capability reporting и multi-model behavior. Затем отдельно разрешённый H1 read-only camera inspection. H2 writes/EVF/AF и H3 shutter/transfer требуют отдельных заданий. DATA-005, Retain/Release sentinel, SendCommand/FocusInfo ABI и ACK order не разрешаются этим двухфункциональным N2. Public README/installation/UI остаются до фактической квалификации и согласованной PSE-first миграции.

# N2 admission closure

Актуальный результат 21 ноября 2026: **N2 DONE — SOURCE_ZERO_CYCLE, exit 0.** После отдельного разрешения пользователя выполнен один init/terminate cycle с закреплённой PSE x64 DLL: raw init=0, terminate=0, unloaded=true, comBalanced=true; естественный exit и пустое Job tree подтверждены. Камера не подключалась. В stderr сохранена nonfatal stdout-sync diagnostic; исходный источник не установлен. Module sampling не захватил краткую загрузку Canon DLL и не доказывает полную dynamic closure. Приватные manifest/logs остаются вне Git. [Протокол и границы результата](N2_EXECUTION_PLAN.md).

Неизвестные структуры H1 не входят в двухфункциональный N2. Подтверждение пользователем применимых условий локального использования учитывается отдельно от технической совместимости и не является доказательством Canon grant; универсальное требование отдельного письменного разрешения Canon не вводится. Ни повтор N2, ни аппаратные этапы этим документом не разрешены. Далее сохранён исторический pre-execution ledger: его NOT_RUN и старые manifest identifiers относятся к состоянию до завершённого эксперимента, а не к актуальному N2 результату.

## Точная граница

Baseline bceefcd0d2d26009346ccd312d7aeab7895b7ee9, ветка feat/native-n2-admission. Цель — один новый Windows x64 процесс, одна конкретная DLL, один EdsInitializeSDK и EdsTerminateSDK только после нулевого init. Никакого автоматического fallback, повторного init, enumeration, session, callbacks, Live View, shutter, файлов камеры или H1/H2/H3.

Текущий кандидат: C:\Program Files\Canon\Picture Style Editor\EDSDK.dll из PSE 1.33.10.0. FileVersion/ProductVersion 3.18.40.0, PE x64, 1,522,576 байт, Authenticode Valid / Canon Inc. SHA-256:

    35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627

Хеш отличается от исторического N1 при одинаковом FileVersion. Старые манифесты не годятся ни по DLL, ни по изменившимся source hashes. Повторять широкую инвентаризацию не требуется; текущая identity перепроверена чтением байтов.

## Пять инженерных gate-решений

| Gate | Предварительное решение | Что не утверждается |
| --- | --- | --- |
| Canon lifecycle ABI | VERIFIED_LIFECYCLE_SUBSET для двух no-arg функций. Сохраняется review N1.5 по public reference 13.20.11 p39/sample1 pp193–194 и точным exports | Нет полного ABI или Canon mapping этого PSE SHA к package 13.20.11/13.21.10 |
| Lifecycle order | Один отдельный процесс/attempt. Terminate только после init=0. Неуверенная очистка завершается процессом, повторов нет | Не доказаны vendor-internal cleanup или успешный native cycle |
| Dependency paths | STATIC_PATHS_REVIEWED. Точные PSE sibling bytes, 13 System32 PE identities и evidence hash проверяются admission | Dynamic dependencies остаются NOT_RUN, полной динамической closure нет |
| Native addon | Koffi 2.16.3 x64 совпал с member официального npm tarball и lock SHA-512. Точный addon hash pinned | Addon не загружался; это review identity/source boundary, не исполнение ABI |
| Initialization plan / containment | INITIALIZATION_PLAN_REVIEWED после 13/13 synthetic Job Object tests и observer checks. План и test report pinned | Реальные init effects, module/thread/device/service deltas — NOT_RUN |

Schema 2 отделяет предварительное решение от runtimeObservations. В dry-run они всегда NOT_RUN, даже при ready:true. Готовность не предоставляет право запуска. Legacy schema 1 и исторические booleans не принимаются. Изменение evidence, System32 bytes, sibling set, Node, addon или исполняемого source требует нового манифеста.

## Dependencies и загрузчик

Свежий bounded review находится в ignored dependency-preflight.json. EDSDK имеет 129 named exports и 213 direct import entries: 198 имён и 15 WS2_32 ordinals. Все прямые entries сопоставлены. Delay imports отсутствуют. 18 imported exports перенаправлены через NTDLL/API-set контракты. Текущие Windows host candidates и их exports проверены статически. Точная runtime-resolution API-set alias ещё не наблюдалась; отсутствующий отдельный файл api-ms-* сам по себе не означает missing dependency.

EdsImage.dll и EdsCFParse.dll — подписанные x64 Canon siblings. Их imports и Windows candidates проверены. Embedded строки EdsImage/EdsPsf/mscoree — подсказки, а не доказательство вызова init-only path. EdsPsf рядом отсутствует, но его lifecycle-зависимость не показана. Конкретной отсутствующей direct/delay dependency не выявлено.

Search boundary: абсолютный addon, абсолютные System32 kernel32/ole32, абсолютная PSE EDSDK. SetDefaultDllDirectories допускает только System32 и AddDllDirectory точного PSE каталога. Canon LoadLibraryExW использует SYSTEM32 | DLL_LOAD_DIR. PATH состоит из System32; рабочая и profile папки disposable и не добавлены в DLL search. Вложенный DPP4Lib, EOS Utility, Webcam и Network Tool не добавляются и не используются как fallback.

PSE file/directory, Canon и Program Files parents проверены по DACL/SID, reparse-флагам и Authenticode. Before snapshot повторяет эти проверки и сравнивает ACL hashes с pinned dependency evidence до доставки манифеста worker. Это защищает от наблюдаемых write-grants обычным пользователям, но не исключает privileged administrator replacement, loader TOCTOU или способность самого vendor native code изменять свой процесс. Addon лежит в пользовательском каталоге и защищён byte pinning, не DACL. Его два прямых Windows imports — KnownDLLs KERNEL32/ADVAPI32.

## Ограниченная внешняя supervision

Controller остаётся addon-free. Отдельный pinned addon-free Node supervisor-host создаётся detached, hidden и сохраняет работу после смерти controller. Он запускает встроенный Windows PowerShell 5.1, который владеет единственным non-inherited handle неназванного Windows Job Object с KILL_ON_JOB_CLOSE; breakaway не разрешается.

До любого require Koffi worker отправляет pid/nonce ready и ждёт admission. Supervisor проверяет image path, parent PID, nonce в command line и creation time; затем сопоставляет открытый process handle с этими данными и сохраняет именно этот handle. Только подтверждённый AssignProcessToJobObject разрешает controller отправить manifest. Отказ — остановка без native load. Смерть controller до assignment закрывает IPC, у ожидающего worker есть admission timeout.

15 секунд от delivery — lifecycle deadline. Затем TerminateProcess по сохранённому root handle, ограниченное ожидание, TerminateJobObject для дерева и повторные process/job queries. Kill request не равен exit. Clean требует Node close, signaled root handle и activeProcesses=0. Любой timeout или forced termination исключает SOURCE_ZERO_CYCLE. Короткоживущие descendants выявляются также cumulative totalProcesses; они не разрешены даже если live PID polling их пропустил.

Не подтверждённое дерево даёт UNKNOWN/exit3. При подтверждённом handoff внешний supervisor продолжает cleanup не дольше указанного в receipt срока, затем TerminateJobObject, ограниченный query grace и закрытие kill-on-close job. В файле сохраняются PID/job state/deadline. Сам supervisor имеет 60s монотонный hard deadline, host — 65s timer плюс 500ms kill fallback и максимум 750ms output flush. Закрытие job handle запрашивает OS termination, но не доказывает конечное завершение заблокированного kernel I/O. UNKNOWN запрещает следующий attempt до проверки конкретных PID. Нет бесконечного ожидания controller и скрытого оставления нативного процесса.

## Выполнимый план наблюдений

observe-control.cjs управляет встроенным observe-n2.ps1 без Canon/Koffi, camera handles и обычного application entrypoint.

- Before: Windows build/architecture, runtime SHA/version/signature/DACL, relevant Canon processes/services, passive Camera/Image PnP inventory и доступные TCP/UDP endpoints заданных PID. Неуспех необходимых sections останавливает admission.
- During: ограниченные по времени/объёму периодические module paths, threadCount, handleCount и startTime для root и observed Job PID. Неподтверждённые section/module reads остаются UNKNOWN. Неожиданное дерево запрашивает Job termination.
- After: повторные runtime/trust/process/service/device/endpoint snapshots. observation-review.cjs сравнивает состояния в обе стороны и показывает unexpected module locations, persistent Canon processes, service/device changes и сетевые endpoints.

Модули разрешены по точным pinned Node/addon/PSE sibling paths и непосредственному System32. Остальные пути требуют review; расположение не подтверждает безопасность кода. Нет readable root sample, truncation, unknown module path, изменившиеся trust/bytes или неожиданные effects не дают чистый результат.

Samples не являются packet/USB/RPC tracing. Они могут пропустить кратковременную загрузку, service call, network connection или device open. handleCount не показывает содержимое kernel handles. Init/DllMain могут общаться с уже существующими Canon components без enumeration. Job Object не sandbox и не включает внешние services, запущенные иным владельцем. Остаточный риск должен входить в отдельное разрешение на единственный bounded experiment.

## Canon terms и требуемое действие человека

По уточнённой модели Apertrove не включает, не скачивает и не распространяет Canon DLL. Пользователь отдельно получает официальное ПО Canon; Apertrove предполагает загрузку уже установленной совместимой DLL через Koffi. Отсутствие redistribution не доказывает use rights. Разрешение на перераспространение DLL не является условием текущей модели; право стороннего API-вызова и условия разработки/публичного выпуска собственной программы рассматриваются отдельно.

Canon Asia — известный официальный источник, но не подтверждённый регион установки пользователя. Отдельная EDSDK Developer License/специальное разрешение не предоставлены для проверки; их наличие или отсутствие не предполагается. В доступных текстах не найдено прямого ответа, охватывает ли PSE EULA эту bundled-runtime схему. Нельзя объявлять её разрешённой, запрещённой или требующей отдельного соглашения во всех регионах.

Конкретные положения проверенного регионального SDK-договора, различия между установкой PSE, API use, разработкой, выпуском и redistribution, официальные каналы и готовый неотправленный запрос Canon приведены в [targeted terms review](CANON_RUNTIME_USAGE_REVIEW.md). Применимость к пользователю остаётся открытой. Установленный third-party readme не заменяет Canon grant. Пользователь проверяет фактически принятую EULA либо получает относящееся к этой схеме подтверждение Canon; агент не принимает terms и не отправляет формы.

Техническая подготовка сохранена, исходники и reviewed manifest/evidence не изменены этим уточнением. Регрессии повторно не выполнялись. Отсутствие exact matching headers не превращает двухфункциональный subset в полный ABI и не добавляет отдельного технического требования перераспространять/лицензировать redistribution.

## Production lifecycle и PSE-first migration

Production не изменён. camera-worker.load() может перейти к другому кандидату после init failure, а sdkEnvironment({recheck:true}) способен terminate/reinitialize в том же worker. До H1 нужно минимально оградить повторный init и выполнять новый candidate/recheck в свежем процессе с подтверждённой остановкой предыдущего. Эта отдельная работа не блокирует N2 в независимом one-attempt worker.

После фактического N2, production correction и H1 evidence выполнить согласованную миграцию:

| Файлы | Изменение |
| --- | --- |
| README.md / README.ru.md step 3 | PSE-first только для подтверждённых x64 версий, официальная Canon загрузка, условия зависят от выпуска |
| docs/INSTALLATION.md section 3 | PSE путь, проверка architecture/version/dependencies, исключить unofficial DLL copying |
| docs/REQUIREMENTS.md | Предпочтительный verified runtime и допустимые альтернативы отдельно |
| docs/TROUBLESHOOTING.md | Missing DLL, dependency, wrong architecture, unsupported SDK version, init failure, no camera и unsupported feature отдельно |
| en-US.json / ru-RU.json + Onboarding | Согласованные setup text/link/error states; EOS Utility closing advice сохранить при contention |

Текущий resolver уже обнаруживает PSE как первый имеющийся standard x64 candidate после отсутствующих x64 EOS Utility roots. После квалификации рассмотреть только перестановку PSE перед standard EOS Utility с сохранением explicit custom/EDSDK_DIR precedence, архитектурной проверки и существующих legitimate alternatives. Публичные установки/UI сейчас не переключены.

## Evidence и запуск

Точные команды, exit codes, свежий manifest hash и independent verdict сохраняются под qa/native-n2-admission/. Все proprietary binaries/headers остаются вне Git. Только локальные коммиты; push/PR/merge/release не выполняются.

Свежий schema 2 manifest: n2-manifest-50423378-d347-4808-9c96-5f9238f091ef.json, SHA-256 d46669989bee4b0e96bca669ef56bae4176a14e263aad94dc87ceac2c7249574. Адресный dry-run завершился exit0, ready:true, blockers:[], nativeLoaded:false, nativeResult:NOT_RUN, authorization:NOT_GRANTED. Dynamic dependencies, initialization effects и native lifecycle остались NOT_RUN.

Финальные проверки:

| Команда | Результат |
| --- | --- |
| node --no-addons --max-old-space-size=192 --test tests/native-n1/check.cjs | 12 PASS, exit0, включая schema/evidence/system-file negative tests и PE directory без named exports |
| node --no-addons --max-old-space-size=192 --test --test-timeout=60000 tests/native-n1/watchdog.cjs | 13 PASS, exit0; exception — uncaught JavaScript exception, не Canon/access violation |
| node --no-addons --max-old-space-size=192 qa/native-n2-admission/observer-safe-test.cjs | 12 assertions, exit0; реальные harmless addon-free процессы, Before/After sectionErrors:[] |
| npm test | 52 PASS, exit0 |
| npm run test:t1 | 41 PASS, exit0 |
| npm run preflight | 280 allowlisted files, exit0 |

Watchdog evidence включает реальные normal/nonzero/exception exits, timeout, ignored graceful request, exit/escalation race, injected failed-confirmation UNKNOWN, EOF, abrupt controller death, supervisor death, descendants и 10s idle-pipe deadline (~10.4s). Это Windows containment evidence, не native Canon success. Build/i18n/S2C не запускались: production/frontend/locales/S2C не менялись.

Независимый reviewer проверил retained handles, assignment-before-admission, deadlines, bridge, UNKNOWN, dependency/effects semantics и итоговый watchdog report. Блокирующих technical findings не осталось. Applicable Canon rights и отдельная пользовательская авторизация этим review не предоставляются.

Будущий execute требует отдельного явного разрешения пользователя, физического отключения USB/сетевых Canon камер, закрытых Canon приложений и осознанного подтверждения применимых Canon terms. Dry-run не содержит этих подтверждений и не запускает supervisor, observer или worker.

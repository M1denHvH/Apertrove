# Canon runtime usage — targeted terms review

Дата проверки: 20 ноября 2026 года. Это сопоставление доступных официальных текстов и указанной пользователем модели. Применимый договор конкретной установки пока не установлен. Статус N2: BLOCKED_VENDOR_OR_LICENSE / APPLICABLE_TERMS_UNRESOLVED. Это не вывод, что использование разрешено или запрещено.

## Подтверждённые вводные и границы

По уточнению пользователя, PSE 1.33.10 получен из официального дистрибутива Canon; точный региональный сайт и принятая EULA не подтверждены. Canon South & Southeast Asia рассматривается только как известный официальный источник, не как установленный источник этой копии. Отдельная Canon EDSDK Developer License или специальное разрешение не предоставлены для проверки; это не утверждение об их отсутствии.

Apertrove распространяет собственную программу без Canon DLL в репозитории, установщике и дистрибутиве. Программа не скачивает DLL и не передаёт их другим пользователям. Пользователь отдельно устанавливает официальное ПО Canon, а Apertrove предполагает обнаружение уже установленной подходящей EDSDK.dll и загрузку через Koffi. Неофициальные standalone DLL не допускаются. Здесь зафиксирована заявленная модель; новая проверка всех release artifacts не проводилась.

Отсутствие распространения не устанавливает право использования API. Отдельное право на перераспространение Canon DLL не ставится условием текущей модели, пока Canon-компоненты не передаются в составе или через Apertrove. Это не отменяет возможные условия локального использования; их нужно установить отдельно. Если модель распространения изменится, этот вопрос рассматривается заново.

## Отдельные вопросы

| Вопрос | Что установлено | Что остаётся неизвестным |
| --- | --- | --- |
| Установка и использование PSE пользователем | Официальное происхождение дистрибутива сообщено пользователем | Точный источник, версия принятой EULA, территория и охватываемые способы использования |
| Загрузка DLL из PSE сторонним приложением | В проверенных публичных условиях не найдено прямого разрешения именно этой схемы | Охватывает ли действующая PSE EULA вызовы из отдельного стороннего процесса; требуется ли иной grant |
| Разработка Apertrove через EDSDK API | Canon публикует developer-license route; ниже приведён конкретный региональный пример | Применимый к этому разработчику договор и охват installed PSE runtime |
| Выпуск собственной программы без DLL | Передача Canon binaries не входит в заявленную модель | Разрешения/обязанности по разработке и публичному выпуску API-потребителя, возможная необходимость developer registration |
| Перераспространение Canon DLL | Не предполагается | Не является самостоятельным blocker текущего N2; права на него не запрашиваются автоматически |

Установка PSE сама по себе не используется здесь как доказательство права стороннего API-вызова. Вместе с тем отсутствие отдельной лицензии в переданных материалах не доказывает запрет или универсальную обязанность получить новое разрешение. Нужен применимый текст либо ответ Canon о данной схеме.

## Проверенные официальные тексты

### PSE download disclaimer — региональный пример

[Canon South & Southeast Asia, Picture Style Editor 1.33.10, Disclaimer](https://asia.canon/en/support/0200774903).

Страница ограничивает предоставляемое содержимое личным некоммерческим использованием и содержит ограничения на передачу, копирование, модификацию и reverse engineering; отдельно говорит об экспорте. Это условия данной страницы. Они не устанавливают автоматически договор для копии из другого региона и не дают прямого ответа о standalone third-party load. Коммерческое/некоммерческое использование, software integration и redistribution — разные вопросы.

### Canon Singapore SDK application terms — применение условно

[Terms & Conditions for Canon Digital Camera Software Development Kit](https://asia.canon/en/campaign/developerresources/terms-conditions-for-digital-camera-software-development-kit-sdk):

- Пункт 2(a)–(c): grant на использование object-code SDK ограничен заявленной целью и страной/регионом заявки.
- Пункт 3: распространение самого SDK регулируется отдельно, как части Developer Software.
- Пункт 4: использование SDK вне разрешённых условий ограничено; также запрещены development tools на его основе. Это не классификация Apertrove как development tool.
- Пункт 5: срок grant отсчитывается от уведомления Canon об одобрении заявки.

Для заявителя именно по этому пути пункты 2, 4 и 5 объясняют основание use/development approval, даже когда redistribution не планируется. Нельзя переносить эти пункты на пользователя, не установив применимость договора. Они не подтверждают, что bundled PSE DLL автоматически охвачена SDK grant, и не доказывают обязательность такого договора во всех регионах.

[Официальная Asia application form](https://asia.canon/en/campaign/developerresources/sdk/form?sdk=310) ограничивает этот путь юридически зарегистрированными организациями перечисленных территорий. Не следует заявлять чужую территорию/правовой статус или подавать форму только ради доступа. Подача заявки предусматривает согласие с условиями; агент её не отправлял.

### Canon Europe — официальный канал уточнения

[Canon Europe SDK page, FAQ и Download Canon SDK](https://www.canon-europe.com/business/imaging-solutions/sdk/) направляет за доступом в Developer Portal и указывает, что CDP support требует регистрации.

Официальные адреса: [Developer Portal](https://developers.canon-europe.com/developers/s/login/), [CDP support](https://developers.canon-europe.com/developers/s/support). Прямое чтение support/FAQ в этой проверке завершилось timeout; условия из закрытой области не получены. Маркетинговая страница не заменяет лицензию. Региональную доступность и eligibility проверяет пользователь; его юрисдикция по настройкам компьютера не выводится.

### Установленные материалы

Известный readmeLicensePSE.txt в Documents PSE содержит IJG acknowledgments/third-party terms. Он не устанавливает grant Canon на использование EDSDK сторонней программой. Это не доказывает, что отдельная EULA не существует.

## Практическое закрытие вопроса

1. По сохранённому официальному URL/установщику и показанной при установке EULA установить применимые условия PSE. Не переустанавливать PSE ради проверки и не считать одинаковое имя ZIP доказательством региона.
2. Найти в этих условиях grant для загрузки bundled runtime независимым приложением либо запросить у соответствующего регионального Canon/CDP подтверждение именно такой схемы.
3. Спросить отдельно о локальном init-only N2 и о разработке/публичном выпуске Apertrove без Canon binaries. Не требовать redistribution grant, если binaries не передаются.
4. Если Canon укажет на developer agreement, пользователь проходит подходящий официальный путь и предоставляет относящиеся к использованию положения/подтверждение. Агент не принимает terms и не отправляет заявку.
5. После разрешения вопроса об использовании и отдельного явного допуска на N2 применить существующий технический execution plan. В этом задании такого допуска нет.

Ответ Canon может быть нужен для снятия неоднозначности, а не потому, что проверенные документы уже доказали обязательность специального разрешения. Платность, вид соглашения и обязательные условия публичного релиза по имеющимся данным не установлены.

## Готовый запрос Canon — не отправлен

Subject: Clarification of EDSDK use from a user-installed Picture Style Editor, without DLL redistribution

We develop Apertrove, an independent Windows x64 camera application. Apertrove does not include, download, copy or redistribute Canon SDK binaries, headers or documentation. Users separately obtain and install official Canon software.

The proposed integration would discover a compatible EDSDK.dll already installed with Picture Style Editor and load it in a separate process through Koffi. The currently inspected installation is Picture Style Editor 1.33.10.0, EDSDK.dll FileVersion 3.18.40.0, x64, SHA-256 35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627. The source region and applicable installer agreement are not yet confirmed.

Please identify the applicable agreement and provisions for:
1. A local lifecycle-only experiment calling EdsInitializeSDK once and EdsTerminateSDK only after successful initialization, without camera enumeration or camera operations.
2. Developing and publicly distributing our own application, with no Canon binaries, headers or documentation supplied by us.
3. Whether a PSE end-user agreement can cover this third-party loading model, or a separate Canon developer agreement/approval is required.
4. Whether a developer grant, if required, covers this PSE-shipped runtime or only the runtime supplied through the developer programme, and any regional or commercial-use restrictions.

We are requesting clarification of use and development rights, not a right to redistribute Canon DLLs. Please provide the relevant clause and the official application route if additional authorization is required.

## Техническая преемственность

Изменяется только документация. Исполняемые N2 sources, reviewed evidence и манифест не менялись. Предыдущий addon-free dry-run и тесты сохранены как технические evidence с датой своего выполнения. Текущий legal hold нельзя снять одним флагом acknowledge-canon-terms, подписью файла, ready:true или обещанием не распространять DLL.

Проверка текущего manifest SHA-256 d46669989bee4b0e96bca669ef56bae4176a14e263aad94dc87ceac2c7249574 и всех 11 pinned harness files не выявила изменений. Для этого документа выполнены git diff --check и npm run preflight: 281 allowlisted files, exit0. Source/watchdog/npm regression suites не перезапускались: исполняемые файлы не менялись.

Фактические native load, initialization, Koffi execution, H1/H2/H3 — NOT RUN. Учётные данные, формы и согласия не использовались. Запрос Canon — готовый текст для пользователя, не отправленное сообщение.

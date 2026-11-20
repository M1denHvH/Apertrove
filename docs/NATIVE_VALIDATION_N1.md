# Native Validation N1 — runtime и подготовка N2

Дата: 2026-11-20. Base: `6ad78f873d98f5415fea6c5426c6a416c8527cf5`. Локальная ветка `feat/native-validation-n1`. **PARTIAL:** полезная статическая квалификация и исполняемый guarded harness готовы; matching headers и реальная ABI/runtime проверка не завершены. Canon DLL, Koffi addon, EDSDK init, enumeration и hardware в N1 не исполнялись.

## Установленные компоненты

Исследование начато с EOS Utility: registry DisplayVersion и `EU3/EOS Utility 3.exe` FileVersion/ProductVersion — **3.20.21.1**. Изучены только известные Canon install roots, PE bytes, version resources и Authenticode; фотографии и профили не читались.

| Runtime EDSDK.dll | File/ProductVersion | PE | SHA-256 |
|---|---|---|---|
| `C:\Program Files (x86)\Canon\EOS Utility\EDSDK.dll` | 3.20.20.0 | x86 | `d65b459003fbf6fb08895793a18be489add48c2fa056792ab9ca221c234d89ff` |
| `C:\Program Files (x86)\Canon\EOS Utility\EU3\EDSDK.dll` | 3.20.20.2 | x86 | `e1ed7ef265e2b351b0a2661bce0d7a2ded1ec45254edcc1015f60914671955d5` |
| `C:\Program Files\Canon\Picture Style Editor\EDSDK.dll` | 3.18.40.0 | x64 | `dbebe8a3d415414a4accf822027165fbbf947f25bb6ba68ebbaa1ec0a0fbc019` |
| `C:\Program Files (x86)\Canon\EOS Network Setting Tool\runtimes\windows\native\EDSDK.dll` | 3.18.25.3 | x64 | `da4d797bd4ab7e21d5b621a3c3f0b020eb78937c8488f2077bc7a239df1dc73e` |
| `C:\Program Files\Canon\EOS Webcam Utility\EDSDK.dll` | 13.17.0.6401 | x64 | `26d5947becfa720a0f9ebc418e9205823165d84eedaa9b762f595bf1bdcc0b8c` |

Version resource не равен номеру публичного SDK package. Значение Webcam не нормализуется в предполагаемую версию. EOS Utility-based resolution остаётся предпочтительным, но обе установленные DLL EOS Utility **демонстративно несовместимы по архитектуре** с x64 Apertrove. Существующий `sdkCandidates` уже находит три x64 alternative; отсутствие x86 EU3 в его списке не является доказанной ошибкой. Никакого автоматического N2 fallback или выбора PSE для native execution не сделано.

Все пять DLL содержат 32 реально связываемых production EDSDK exports. PSE/Network дают 129 named exports, Webcam 124; plain `EdsGetPropertyDescEx` отсутствует, `EdsSetFramePoint` есть у x64. Это наличие символов, **не ABI proof**. Три x64 файла имеют Windows Authenticode status Valid/Canon signer на момент наблюдения.

Прямые PE imports: SETUPAPI, WS2_32, KERNEL32, USER32, ADVAPI32, ole32, SHELL32, VERSION. Delay imports не найдены. Их x64 System32 candidates и sibling Canon binaries хэшированы; всего46 PE images. Embedded EdsImage/EdsPsf names — только hints. Recursive Windows forwarders/API sets, динамические LoadLibrary paths и эффекты DllMain/init ещё UNKNOWN. PSE/Webcam имеют EdsImage рядом; это не доказательство полноты closure. Полные hashes/version/dependency tables — ignored `qa/native-n1/runtime-{summary,pe,versions,signatures,discovery}.json`; byte-only inspectors сохранены рядом. Никаких proprietary копий в Git.

## Официальные документы и blocker

Получен публичный **EDSDK API Reference13.20.11**, 258p, дата на cover 2026-03-02. PDF SHA-256: `71c3686452af13e66ffe7bc95e40f84264d7a368288d5231ccd6999fe27bdc2b`. [Официальная Canon industrial SDK страница](https://industrial.imaging.canon.de/integration/sdk/) ссылается на [этот reference](https://canon-industrial-imaging-production.fra1.digitaloceanspaces.com/wp-content/canon_b2b/uploads/2026/09/15132330/EDSDK_API_EN-4.pdf). Это usable public reference, но не matching header package для пяти найденных DLL.

[Canon Europe SDK](https://www.canon-europe.com/business/imaging-solutions/sdk/) направляет получение development package через [Developer Portal](https://developers.canon-europe.com/developers/s/login/). Без пользовательского входа доступен login/bootstrap, не EDSDK.h/EDSDKTypes.h/EDSDKErrors.h. Аккаунт не создавался, лицензии не принимались, формы не отправлялись. [Официальные release notes](https://asia.canon/en/campaign/developerresources/camera/cap/edsdk-eos-digital-camera-sdk-release-note) отличают public package revisions от Windows file versions; совпадение цифровых фрагментов не устанавливает совместимость.

**Нужное действие:** пользователь получает легальный Windows x64 development package с headers/reference/release notes/license через Canon либо запрашивает у Canon mapping выбранной установленной DLL к developer package. Затем сообщает локальный путь. Не нужны пароль/токен; proprietary files остаются вне Git. Публичность PDF или наличие Canon подписи не предоставляет разрешения на redistribution runtime/headers.

## Изменения и сохранённая функциональность

Подтверждённый узкий source fix: Win32 `SetDllDirectoryW` возвращает 32-битный BOOL, а Koffi C `bool` иной тип. Binding исправлен на `int32`, результат нормализован через zero/nonzero к прежнему boolean telemetry contract. Основания: [Microsoft API](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setdlldirectoryw), [Windows types](https://learn.microsoft.com/en-us/windows/win32/winprog/windows-data-types), установленный Koffi2.16.3 source. Никакие Canon declaration/layout/ACK изменения из одного unmatched PDF не внесены.

Сохранены `camera-discovery` selection/id/model exceptions; `camera-values` supported mappings; descriptors/writable/readback в worker/control; capability report unknown/temporary states; destination fallback; AF/EVF coordination; focus parser; native burst release; S2C ownership/late-transfer/recovery/UNVERIFIED; S2A registration/protected originals. Новых model tables, abstraction layer и EOS2000D ограничений нет. SDK availability, camera descriptors, model exceptions, firmware effects и actual hardware evidence — отдельные уровни; EOS2000D только первый будущий H-device.

## ABI и DATA-005

Полное source/reference сопоставление — `NATIVE_ABI_MATRIX.md`. Pointers/64-bit sizes/callback shapes проверены статически, не вызовами Koffi. Exact runtime ABI **UNKNOWN**. Публичный reference выявляет refcount error sentinel0xFFFFFFFF, одно init/terminate на процесс, отличия SendCommand signedness и FocusPoint layout; они требуют matching package review, а не blanket-disable существующих функций.

Порядок transfer сохранён: Download → Complete → pointer/length → V8 copy → exclusive local write → photo/registration. Public reference §3.1.26–28 требует Complete после download и Cancel при cancellation; перестановка до durable handoff не обоснована. SDK ACK, userspace write, close, registration acknowledgement, OS flush и camera-side state не равны. `writeFileSync`/close не доказывают power-loss durability. DATA-005 остаётся OPEN; H3 single-transfer fault plan описан отдельно.

## Проверка и evidence

Новый `tests/native-n1/check.cjs` — source-only Node tests с generated PE parser fixtures и extracted worker prefix; не native ABI tests. `prepare.cjs` и `run.cjs --dry-run` проверяют actual selected file identities без load. PSE используется только как x64 **dry-run example**, не назначенный native provider.

Фактические commands/exits/source hashes/review определяются ignored `qa/native-n1/verification-ledger.json` и `independent-review.md`. Неисполненные N2/H1/H2/H3, native struct sizeof/ABI/callback и OS handle checks не получают PASS. Никаких push/merge/release в N1.

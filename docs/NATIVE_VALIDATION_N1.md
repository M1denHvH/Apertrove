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

Новый tests/native-n1/check.cjs — source-only Node tests с generated PE parser fixtures и extracted worker prefix; не native ABI tests. prepare.cjs и run.cjs --dry-run проверяют actual selected file identities без load. Updated PSE DLL — предпочтительный кандидат для квалификации, не утверждённый production resolver provider.

Фактические commands/exits/source hashes/review определяются ignored qa/native-n1/verification-ledger.json и ignored qa/native-n2-prep/ в этой ветке. Неисполненные N2/H1/H2/H3, native struct sizeof/ABI/callback и OS handle checks не получают PASS. Push/merge/release не выполнялись.

## N1.5 addendum — current Picture Style Editor

20 ноября 2026 года повторно проверена установленная PSE 1.33.10.0. PSEditor.exe is x64, SHA-256 b4f3f47b24a2b90ac43fb7491d65c98cc2ddb305a83018297c2c19bfdb5fead1, with a valid Canon Inc. Authenticode signature. Its EDSDK.dll is x64, File/ProductVersion 3.18.40.0, 1,522,576 bytes, SHA-256 35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627, also validly signed by Canon Inc.

Version and size match the N1 PSE record, but the DLL hash differs. No trusted old copy with the N1 hash was found in checked Canon roots. The updated bytes are confirmed, while whether the change is code or signature-only remains UNKNOWN. The old hash is historical and is not used for admission. Fresh byte-only evidence for the PSE tree, sibling DLLs, versions, imports, exports and signatures is in ignored qa/native-n2-prep/runtime-pse-inventory.json. Sibling EdsImage.dll and EdsCFParse.dll also changed. EOS Utility EDSDK candidates remain x86 and cannot load into the x64 process.

The current DLL has the same 129 export names and ordinals as the N1 snapshot, including all 31 worker symbols and both lifecycle export names. Export presence is not ABI compatibility. Its direct PE import entries were matched against exports of eight x64 System32 candidates. Windows forwarder/API-set recursion, dynamic loads, sibling transitive dependencies, DllMain behavior and initialization effects remain UNKNOWN; the dependency and effects admission gates remain open.

The official public Canon reference 13.20.11 supports a narrow lifecycle-order assessment for the two-function init-only N2 scope. It does not map that package to the refreshed DLL SHA or replace matching headers. The manifest does not claim full ABI or camera compatibility.

Koffi 2.16.3 was reviewed statically: the local x64 addon SHA-256 1305fdf18bcb5e71c1cd0530cd0834b9858beb01606f58086e587343809bfa3b exactly matches win32_x64/koffi.node in the official npm registry tarball whose SHA-512 matches package-lock integrity. The addon directly imports only KERNEL32.dll and ADVAPI32.dll. Neither it nor any Canon binary was executed.

The N2 manifest now pins prepare.cjs with the manifest, runner and worker. On the 15-second watchdog, the parent requests child termination and retains process supervision until Windows confirms close. It no longer detaches after a fixed 17-second bound. An unconfirmed process remains supervised/UNKNOWN, never a completed run.

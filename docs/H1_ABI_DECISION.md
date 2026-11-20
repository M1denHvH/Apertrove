# H1 ABI decision — Canon read-only diagnostics

**Решение: BLOCKED. H1 остаётся NOT RUN и не готов к отдельному разрешению на работу с камерой.** Это решение о доказанности native ABI, не о правах использования SDK.

## Статус ABI

| Тип / группа | Статус | Основание |
|---|---|---|
| `EdsDeviceInfo`, `EdsPropertyDesc`, `EdsAccess`, `EdsDataType`, `EdsChar`, layout/padding | **UNKNOWN** | Нет полного текущего Canon declaration и размера/packing, связанных с установленным PSE runtime. `EdsDeviceInfo` и `EdsPropertyDesc` записываются нативной DLL в Koffi-буферы. |
| `EdsUInt32`, `EdsInt32` | **PARTIAL** | Справочник описывает типы и 4-байтовый `EdsRetain` return, но нет SDK typedef header, подтверждённого для указанной DLL. |
| Opaque refs, указатели и H1 callbacks | **PARTIAL** | Формы `Ref*`/out pointers и прототипы событий описаны; exact calling macros, current binary mapping и callback lifetime/quiescence не подтверждены. |
| `EdsGetPropertySize`, `EdsGetPropertyData`, discovery/session/refcount functions | **PARTIAL** | Формы аргументов, результат и ownership частично документированы. Это не proof совместимости функций с конкретной DLL. |
| `EdsGetDeviceInfo`, `EdsGetPropertyDesc` | **UNKNOWN** | Вызовы используют layouts из предыдущей строки `UNKNOWN`; эти функции действительно входят в discovery/diagnostic path. |
| **QUALIFIED** | **Нет** | Нет matching official headers или иного подтверждения точного ABI для текущего runtime. |

Подробные формы, арифметические оценки source-layout, страницы справочника и остаточная неопределённость приведены в [NATIVE_ABI_MATRIX.md](NATIVE_ABI_MATRIX.md). `sizeof` / `alignof` / `offsetof` probe не собирался: matching headers локально не найдены. Публичный Reference 13.20.11 указывает, что типы API определены в `EDSDKTypes.h` и за последними definitions надо обращаться к header (§1.4.1, §6.2); исторический header не был бы достаточным основанием для PSE DLL.

Кандидат, который проверен только как файл: Windows x64 `C:\Program Files\Canon\Picture Style Editor\EDSDK.dll`, file version `3.18.40.0`, `1,522,576` bytes, SHA-256 `35c5fd7564cf8eee3bc41004a0ab21d96caccb36ea1a1ddb512caf7b1c046627`, Authenticode `Valid`, signer `Canon Inc.`. Версия и подпись не устанавливают соответствие заголовков этому binary.

## H1 и H1A

H1 **BLOCKED** до получения доступных официальных declarations и подтверждения их применимости к runtime либо другого vendor-backed ABI evidence. Вызов H1 сейчас может передать неподтверждённый output layout в `EdsGetDeviceInfo` или `EdsGetPropertyDesc`.

H1A не имеет безопасного допуска сейчас. Отказ от DeviceInfo/PropDesc оставляет только список/счётчик камер, но `EdsGetCameraList`, `EdsGetChildCount`, `EdsGetChildAtIndex`, owned refs, output pointers и release всё равно требуют совместимого pointer/calling/ownership ABI. Одного количества недостаточно, чтобы выбрать EOS 2000D при нескольких устройствах. Поэтому это только возможный будущий, отдельно проверяемый эксперимент после qualification этих базовых функций; запуск не разрешён.

Код диагностики уже намеренно **не вызывает `EdsGetVolumeInfo`**; `EdsVolumeInfo` остаётся U, а отчёт явно указывает, что сведения о томе не запрашивались. Источник H1 остаётся read-only: не меняет SaveTo/Capacity и не запускает shutter, EVF, AF, импорт или удаление. Эти ограничения не компенсируют неизвестные DeviceInfo/PropertyDesc layouts.

## Smoke attribution и ограничения

Ранее сохранённые IC01 H1/histogram отчёты содержали `sourceCommit: 0284c546…`, а runner лишь переписывал launcher environment и не сверял его с Git HEAD. Проверка 73 tracked entries из старых `sourceHashes` совпала с содержимым `81beeddb…`; три файла отличаются только CRLF/LF нормализацией. Остальные 60 хэшей относятся к тогдашнему generated `dist`. Это подтверждает содержимое источников лучше, чем старое поле, но не устанавливает, почему launcher передал родительский commit `0284c54…`; старое поле само по себе не является доказательством tested HEAD или baseline. Новый узкий IC01 runner пишет `testedHead`, требует равенство launcher SHA с `git rev-parse HEAD`, отдельно хранит optional `baselineCommit`, а `sourceHashes` перечисляет фактически прочитанные файлы и проверяет их неизменность до конца прогона.

N2 technical admission остаётся READY по ранее принятому решению; настоящее native execution — NOT RUN; применимые Canon terms остаются `APPLICABLE_TERMS_UNRESOLVED`. Юридический статус здесь повторно не исследуется. Следующий короткий технический шаг: получить официальный matching package/declarations и подтвердить связь с runtime, выполнить только compile-time type/layout probe, затем пересмотреть H1/H1A. Реальное исполнение — только после отдельного допуска и разрешения условий Canon; ни DLL, ни камера в этой работе не запускались.

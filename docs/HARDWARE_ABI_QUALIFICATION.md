# Windows x64 H1 ABI: точечное техническое обоснование

Эта проверка обосновывает конкретные declarations для ограниченного H1. Она не объявляет аппаратные проверки выполненными и не устанавливает соответствие исторических headers конкретному Canon DLL SHA. Proprietary headers в Git не добавлены. Native/Koffi/камера при подготовке этого evidence не запускались.

## Источники и provenance

- **Текущий официальный Canon Reference 13.20.11**, PDF SHA-256 `71c3686452af13e66ffe7bc95e40f84264d7a368288d5231ccd6999fe27bdc2b`: §2.14, стр. 37 прямо определяет `EdsChar` через C `char`, `EdsInt32` через `long`, `EdsUInt32` через `unsigned long`, `EdsBool` через `int`. Предыдущее утверждение, что Reference не содержит basic typedefs, было слишком строгим. §3.1.9 описывает DeviceInfo; §6.2.2, стр. 189 — порядок полей PropertyDesc и 128 значений; §3.1.17–20 — property calls; §3.1.47–49 — callback prototypes.
- **Архивный Canon header**, опубликованный сторонним проектом [pyedsdk, commit d869507, 2010](https://github.com/andrewrk/pyedsdk/blob/d869507ede081c2859d3935b1d0600dba0f7f552/edsdk/EDSDKTypes.h), Git blob `531cbeb1caa9081f63ec790cb333585d1a3ec200`. Copyright header 2006–2008; Windows packing, string bound и поля DeviceInfo/PropertyDesc используются только как историческое corroboration.
- Независимо размещённый [архив EDSDK 2.11, commit 3134c2a, 2013](https://github.com/samizzo/canon-tweet/blob/3134c2a2781d2995d6797290233b68395980b9ee/EOS%20SDK%20v2.11%20Windows/EDSDK/Header/EDSDKTypes.h), blob `18a7f8ec0de10bb55a533ab95bc71491b2cd15c9`, даёт те же рассматриваемые layouts. Это тоже не matching official package для установленной DLL.
- Более поздняя копия [ofxEdsdk, header update commit d4fdeb8, 2017](https://github.com/kylemcdonald/ofxEdsdk/blob/d4fdeb89803d4f12518b024c1589102bce98cd2c/libs/EDSDK/include/EDSDKTypes.h), blob `f69d1c44bc15da1688c8c02ec1f84785b4e4244a`, вновь даёт те же размеры массивов, packing и рассматриваемые поля. Несколько публикаций одного vendor API подтверждают стабильность объявления, а не независимое измерение DLL.
- Первичный источник Windows: [Microsoft x64 storage/layout rules](https://learn.microsoft.com/en-us/cpp/build/x64-software-conventions?view=msvc-170), [размеры MSVC C/C++ типов](https://learn.microsoft.com/en-us/cpp/cpp/data-type-ranges?view=msvc-170), [поведение `__stdcall` на x64](https://learn.microsoft.com/en-us/cpp/cpp/stdcall?view=msvc-170). Windows использует 4-байтовый `long` и 8-байтовый pointer; x86-правила stack cleanup не переносятся на Windows x64.

## Layout и соответствие binding

| Тип | Технически обоснованный Windows x64 ABI | Apertrove/Koffi и вывод |
|---|---|---|
| `EdsChar` | C char: размер/alignment 1/1; signedness не меняет размер строкового массива | `char[256]` совпадает по physical layout. Кодировка строк — отдельная семантика, не основание делать массив WCHAR. |
| `EdsInt32`, `EdsUInt32`, `EdsBool` | signed long / unsigned long / int: 4 байта, alignment 4 | `int32`, `uint32`, 32-битный Bool дают нужную физическую ширину. Не путать Canon Bool с однобайтовым C++ bool. |
| Opaque refs и pointers | Ref — pointer на opaque object, 8 байт/alignment 8; Ref output — pointer-to-pointer | `void*` и `void**` соответствуют этой границе; ref не превращать в JS Number или long. |
| `EdsDeviceInfo` | Архивы задают Windows pack 8, два char-массива по 256, затем UInt32 subtype/reserved. Размер **520**, alignment **4**, offsets **0, 256, 512, 516** | Текущая Koffi-структура полностью совпадает с этими corroborated declarations. Поле reserved подтверждено всеми тремя архивами, а не придумано для padding. |
| `EdsPropertyDesc` | form/access/count/values[128]; размер **524**, alignment **4**, offsets **0, 4, 8, 12** | Архивы называют access signed Int32, текущий Reference — EdsAccess. Оба рассмотренных Windows mapping имеют ширину/alignment 4, поэтому layout совпадает с Koffi `int32 × 3 + int32[128]`. Access в Reference reserved/0; не выводить из него разрешение записи. |
| `EdsAccess` | Unscoped enum: значения 0, 1, 2, sentinel FFFFFFFF; MSVC representation имеет размер/alignment 4 | Если access интерпретируется семантически, FFFFFFFF нормализовать как unsigned error; текущий H1 его не использует для write policy. |
| `EdsDataType` | Архивный unscoped enum с небольшими неотрицательными type IDs, размер/alignment 4 | `EdsGetPropertySize` output как `uint32*` сохраняет все 32 бита enum. Декодировать только известные возвращённые type/size пары. |

Сочетание текущего Canon Reference, повторяющихся архивных declarations и Windows ABI даёт достаточное техническое обоснование этих ограниченных layouts; конкретной несовместимости текущих DeviceInfo/PropertyDesc bindings не обнаружено. Это не обещание отсутствия vendor bug или совместимости любой версии/модели. Не использовать oversized buffers либо guessed offsets вместо этих объявлений.

## Compile-only probe

Локальный `qa/hardware-validation/abi/h1-layout-probe.cpp` содержит небольшую независимую transcription рассматриваемых типов и `static_assert` для размеров/alignment/offsets, enum representation, function/callback pointer width и Windows x64 equivalence обычного convention с `__stdcall`. Probe SHA-256 `1a3b6f739341d164b7d1ad2221b94a546e9207977df20af8cafd817db63e016f`.

MSVC **14.52.36725 Hostx64/x64**, `/c /std:c++17 /W4 /permissive- /Zc:enumTypes`: **exit 0**. Проверены оба варианта PropertyDesc access — historical Int32 и Reference enum. Сохранены `.obj`, console и `h1-layout-probe-result.json` в этой ignored QA-папке. Linker не вызывался, executable не создавался/не запускался, Canon headers/import library не использовались и DLL не загружалась. Probe доказывает layout reviewed declarations под Windows compiler; он не измеряет бинарный layout внутри DLL и не является аппаратным PASS.

## Callback boundary и минимальный read-only путь

Reference и архивы согласуют object callback как `(event32, refPointer, contextPointer)`, property callback как `(event32, property32, param32, contextPointer)`, state callback как `(event32, data32, contextPointer)` с 32-битным EdsError return. Архивный EDSCALLBACK раскрывается в EDSSTDCALL; на Windows x64 `__stdcall` использует обычный x64 ABI. Koffi prototypes соответствуют этим формам. Размер и convention не доказывают callback lifetime или quiescence при unregister.

Для bounded H1 разумно не регистрировать camera callbacks: текущий read-only object callback при RequestTransfer вызывает EdsDownloadCancel, что выходит за простое чтение диагностики. В read-only режиме пропустить три camera-handler registrations, соответственно не снимать неустановленные handlers; H1 не должен зависеть от event-pump callback activity. Working session сохраняет собственный production callback путь.

H1 сохраняет только discovery/выбор, OpenSession, безопасные property size/type/data/descriptor reads и CloseSession/ref release. При чтении variable data брать точный размер из GetPropertySize с существующим верхним пределом; не декодировать неизвестный формат. VolumeInfo, card traversal, SaveTo/Capacity writes, capture/download/cancel, EVF и AF не нужны. После каждого stage требуется подтверждённый cleanup; неожиданный native результат не разрешает тихий retry.

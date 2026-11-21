const { PROPS, WHITE_BALANCE_COLOR_TEMPERATURE } = require('./camera-values.cjs');
const NAMES = {
  iso: 'ISO', shutter: 'Выдержка', aperture: 'Диафрагма', compensation: 'Экспокоррекция',
  whiteBalance: 'Баланс белого', colorTemperature: 'Цветовая температура', pictureStyle: 'Picture Style', meteringMode: 'Замер экспозиции',
  driveMode: 'Режим протяжки', imageQuality: 'Формат кадра', afMode: 'Режим AF', liveAfMode: 'Метод AF Live View'
};
const hex = code => '0x' + (code >>> 0).toString(16).toUpperCase();
function readStatus(code) {
  if (!code) return 'ready';
  if ([0x50, 0x52, 0x80, 0x81, 0xc0, 0xc1, 0xa102, 0x2019].includes(code & 0xffff)) return 'temporary';
  if ([0x1, 0x7, 0x2005, 0x2006, 0x200a].includes(code & 0xffff)) return 'unknown';
  return 'error';
}
function capabilityReport({ state, read, storage, exports, restricted, evidence = {} }) {
  const rows = [];
  const add = (group, id, label, status, detail) => rows.push({ group, id, label, status, detail });
  const probe = (group, id, label, result, detail) => add(group, id, label, readStatus(result.code), result.code ? `${detail} · ${hex(result.code)}` : detail);
  for (const [key, id] of Object.entries(PROPS)) {
    const property = state.properties[key];
    const group = ['afMode', 'liveAfMode'].includes(key) ? 'Фокус' : 'Экспозиция и параметры';
    if(key==='colorTemperature'&&state.properties.whiteBalance?.value!==WHITE_BALANCE_COLOR_TEMPERATURE){
      add(group,key,NAMES[key],'temporary','Доступно, когда баланс белого установлен на цветовую температуру.');
      continue;
    }
    const data = read(id);
    if (data.code) probe(group, key, NAMES[key], data, 'Чтение свойства');
    else {
      const desc = property?.descriptorCode;
      const current=property?.choices?.find(choice=>choice.value===property.value)?.label;
      const detail = property?.writable ? [current&&`Текущее: ${current}`,`Разрешено значений: ${property.allowed.length}`].filter(Boolean).join(' · ')
        : desc ? `Значение прочитано. Список для записи недоступен · ${hex(desc)}` : 'Значение прочитано. Разрешённых вариантов записи нет.';
      add(group, key, NAMES[key], property?.writable ? 'ready' : desc ? readStatus(desc) === 'error' ? 'error' : 'temporary' : 'temporary', detail);
    }
  }
  probe('Экспозиция и параметры', 'mode', 'Режим съёмки', read(0x400), 'Чтение положения диска');
  for (const [id, label, prop] of [['availableShots','Оставшиеся кадры',0x40a],['lens','Объектив',0x40d]])
    probe('Экспозиция и параметры', id, label, read(prop), 'Чтение свойства');
  const captureGroup = 'Затвор и съёмка';
  const evfGroup = 'Live View';
  const focusGroup = 'Фокус';
  const storageGroup = 'Носители и передача';
  const unknownCommand = 'Подтверждается только при выполнении команды пользователем.';
  add(captureGroup, 'capture', 'Удалённая съёмка', restricted ? 'unsupported' : evidence.capture ? 'ready' : state.saveTo ? 'unknown' : 'temporary',
    restricted ? 'Canon предусматривает для этой модели импорт.' : evidence.capture ? 'Получен файл после команды съёмки.' : state.saveTo ? 'Назначение на ПК настроено. Спуск ещё не проверен.' : 'Нужно рабочее соединение с сохранением на ПК.');
  add(captureGroup, 'shutterPress', 'Полунажатие / полный спуск', restricted ? 'unsupported' : 'unknown', unknownCommand);
  add(captureGroup, 'bulb', 'BULB', 'unsupported', 'Протокол BULB этой камеры и версии SDK не квалифицирован. Команды старта, остановки и блокировки UI не отправляются.');
  add(captureGroup, 'interval', 'Интервал и таймер', restricted ? 'unsupported' : evidence.capture ? 'ready' : 'unknown', 'Интервал выполняет Apertrove. Таймер камеры определяется списком режимов протяжки.');
  add(captureGroup, 'captureEvents', 'Завершение съёмки', evidence.capture ? 'ready' : 'unknown', 'Ожидается передача файла, включая серию RAW + JPEG.');
  const evf = read(0x500);
  add(evfGroup, 'liveView', 'Запуск и остановка Live View', restricted ? 'unsupported' : evidence.evf ? 'ready' : evf.code ? readStatus(evf.code) : 'unknown', evf.code ? `Чтение назначения EVF · ${hex(evf.code)}` : evidence.evf ? 'Поток EVF подтверждён кадром.' : 'Назначение EVF прочитано. Запуск проверяется отдельно.');
  add(evfGroup, 'frames', 'Поток и параметры кадров', evidence.evf ? 'ready' : restricted ? 'unsupported' : 'temporary', evidence.evf ? 'Получен кадр EVF. FPS измеряется в окне съёмки.' : 'Проверяется после включения Live View.');
  const zoom = read(0x507);
  add(evfGroup, 'evfZoom', 'Аппаратное увеличение EVF', zoom.code ? readStatus(zoom.code) : 'unimplemented', zoom.code ? `Чтение EVF Zoom · ${hex(zoom.code)}` : 'Масштаб камеры прочитан. В рабочем окне используется масштаб изображения на ПК.');
  const position=read(0x508);
  add(evfGroup, 'evfPan', 'Положение области увеличения', position.code ? readStatus(position.code) : 'unimplemented',
    position.code ? `Чтение EVF Zoom Position · ${hex(position.code)}` : 'Координаты прочитаны. Их изменение требует проверки границ на конкретной модели.');
  const mf = state.properties.afMode?.value === 3;
  add(focusGroup, 'autofocus', 'Автофокус', restricted ? 'unsupported' : mf ? 'temporary' : evidence.autofocus ? 'ready' : 'unknown', mf ? 'Объектив в MF.' : unknownCommand);
  add(focusGroup, 'servo', 'AI Servo', restricted ? 'unsupported' : state.capabilities?.servo ? 'unknown' : 'temporary', state.capabilities?.servo ? 'Режим AF подтверждается чтением. Принятая команда AF не подтверждает непрерывное оптическое слежение.' : 'Камера должна предоставить режим AI Servo для выбора или чтения.');
  add(focusGroup, 'driveLens', 'Электронная доводка фокуса', restricted ? 'unsupported' : mf || evf.code ? 'temporary' : evidence.driveLens ? 'ready' : 'unknown', mf ? 'Объектив в MF.' : 'Требуется совместимый объектив и доступный Live View.');
  const focus = read(0x104);
  add(focusGroup, 'focusInfo', 'Информация о точках фокуса', evidence.focusInfo ? 'ready' : readStatus(focus.code), focus.code ? `Чтение на камере · ${hex(focus.code)}. Данные могут появиться в EVF.` : 'Камера отдаёт блок FocusInfo.');
  add(storageGroup, 'volumes', 'Носители камеры', storage.volumes.length ? 'ready' : storage.unverifiedLayout ? 'unknown' : storage.code ? readStatus(storage.code) : exports.volume ? 'temporary' : 'unknown',
    storage.volumes.length ? `Носителей с доступной информацией: ${storage.volumes.length}` : storage.unverifiedLayout ? 'Volume details were skipped because the EdsGetVolumeInfo layout is not qualified for this runtime.' : storage.code ? `Чтение носителей · ${hex(storage.code)}` : 'SDK не вернул доступный носитель.');
  add(storageGroup, 'cardFiles', 'Папки, файлы и импорт с карты', evidence.card ? 'ready' : storage.unverifiedLayout ? 'unknown' : storage.volumes.some(v => v.type !== 0 && [0, 2].includes(v.access)) ? 'unknown' : 'temporary', storage.unverifiedLayout ? 'Card access was not probed; diagnostics do not traverse the card file tree.' : 'Проверяется при открытии импорта с карты. Диагностика не обходит весь носитель.');
  const destination=read(0xb);
  const target=destination.buffer?.length===4?destination.buffer.readUInt32LE():null;
  probe(storageGroup, 'saveTo', 'Место сохранения', destination, ({1:'Карта памяти',2:'Компьютер',3:'Карта и компьютер'})[target]||'Чтение текущего назначения');
  add(storageGroup, 'transfer', 'Передача снимка на ПК', evidence.capture ? 'ready' : 'unknown', state.eventsRegistered ? 'Обработчик передачи зарегистрирован; результат подтверждает полученный файл.' : 'Проверяется при рабочем подключении. Диагностика не принимает файлы.');
  add('События и дополнительные функции', 'events', 'События файлов, параметров и состояния', state.eventsRegistered ? 'ready' : 'unknown', state.eventsRegistered ? 'SDK принял регистрацию трёх обработчиков.' : 'События проверяются при рабочем подключении.');
  add('События и дополнительные функции', 'video', 'Управление видеозаписью', 'unimplemented', 'Доступность зависит от модели, версии SDK и видеорежима. Запись не запускалась.');
  return rows;
}

module.exports = { capabilityReport, readStatus };

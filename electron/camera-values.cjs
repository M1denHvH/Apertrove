const {imageQualityLabel,IMAGE_QUALITIES}=require('./image-quality.cjs');
const WHITE_BALANCE_COLOR_TEMPERATURE=9;
const PROPS = {
  imageQuality:0x100,
  driveMode:0x401,iso: 0x402, meteringMode:0x403, aperture: 0x405, shutter: 0x406, compensation: 0x407,
  whiteBalance: 0x106, colorTemperature: 0x107, pictureStyle: 0x114,afMode:0x404,liveAfMode:0x50e
};
const table = pairs => pairs.map(([value, label]) => ({ value, label }));
const VALUES = {
  imageQuality:IMAGE_QUALITIES,
  meteringMode:table([[1,'Точечный'],[3,'Оценочный'],[4,'Частичный'],[5,'Центрально-взвешенный']]),
  driveMode:table([[0,'Одиночная'],[1,'Серийная'],[2,'Видео'],[4,'Серийная · высокая скорость'],[5,'Серийная · низкая скорость'],[6,'Тихая одиночная'],[7,'Таймер 10 с + серия'],[0x10,'Таймер · 10 секунд'],[0x11,'Таймер · 2 секунды']]),
  afMode:table([[0,'One Shot'],[1,'AI Servo'],[2,'AI Focus'],[3,'MF (объектив)']]),
  liveAfMode:table([[0,'Quick · фазовый'],[1,'Live · по контрасту'],[2,'Live · лица']]),
  iso: table([[0,'Auto'],[0x48,'100'],[0x4b,'125'],[0x4d,'160'],[0x50,'200'],[0x53,'250'],[0x55,'320'],[0x58,'400'],[0x5b,'500'],[0x5d,'640'],[0x60,'800'],[0x63,'1000'],[0x65,'1250'],[0x68,'1600'],[0x6b,'2000'],[0x6d,'2500'],[0x70,'3200'],[0x73,'4000'],[0x75,'5000'],[0x78,'6400'],[0x80,'12800']]),
  aperture: table([[0x08,'f/1'],[0x0b,'f/1.1'],[0x0c,'f/1.2'],[0x10,'f/1.4'],[0x13,'f/1.6'],[0x14,'f/1.8'],[0x18,'f/2'],[0x1b,'f/2.2'],[0x1d,'f/2.5'],[0x20,'f/2.8'],[0x23,'f/3.2'],[0x25,'f/3.5'],[0x28,'f/4'],[0x2b,'f/4.5'],[0x2d,'f/5'],[0x30,'f/5.6'],[0x33,'f/6.3'],[0x35,'f/7.1'],[0x38,'f/8'],[0x3b,'f/9'],[0x3d,'f/10'],[0x40,'f/11'],[0x43,'f/13'],[0x45,'f/14'],[0x48,'f/16'],[0x4b,'f/18'],[0x4d,'f/20'],[0x50,'f/22'],[0x53,'f/25'],[0x55,'f/29'],[0x58,'f/32']]),
  shutter: table([[0x10,'30″'],[0x13,'25″'],[0x14,'20″'],[0x18,'15″'],[0x1b,'13″'],[0x1d,'10″'],[0x20,'8″'],[0x23,'6″'],[0x25,'5″'],[0x28,'4″'],[0x2b,'3.2″'],[0x2d,'2.5″'],[0x30,'2″'],[0x33,'1.6″'],[0x35,'1.3″'],[0x38,'1″'],[0x3b,'0.8″'],[0x3d,'0.6″'],[0x40,'0.5″'],[0x43,'0.4″'],[0x45,'0.3″'],[0x48,'1/4'],[0x4b,'1/5'],[0x4d,'1/6'],[0x50,'1/8'],[0x53,'1/10'],[0x55,'1/13'],[0x58,'1/15'],[0x5b,'1/20'],[0x5d,'1/25'],[0x60,'1/30'],[0x63,'1/40'],[0x65,'1/50'],[0x68,'1/60'],[0x6b,'1/80'],[0x6d,'1/100'],[0x70,'1/125'],[0x73,'1/160'],[0x75,'1/200'],[0x78,'1/250'],[0x7b,'1/320'],[0x7d,'1/400'],[0x80,'1/500'],[0x83,'1/640'],[0x85,'1/800'],[0x88,'1/1000'],[0x8b,'1/1250'],[0x8d,'1/1600'],[0x90,'1/2000'],[0x93,'1/2500'],[0x95,'1/3200'],[0x98,'1/4000']]),
  compensation: table([[0xe8,'−3'],[0xeb,'−2⅔'],[0xed,'−2⅓'],[0xf0,'−2'],[0xf3,'−1⅔'],[0xf5,'−1⅓'],[0xf8,'−1'],[0xfb,'−⅔'],[0xfd,'−⅓'],[0,'0'],[3,'+⅓'],[5,'+⅔'],[8,'+1'],[11,'+1⅓'],[13,'+1⅔'],[16,'+2'],[19,'+2⅓'],[21,'+2⅔'],[24,'+3']]),
  whiteBalance: table([[0,'Авто'],[23,'Авто: приоритет белого'],[1,'Дневной свет'],[2,'Облачно'],[3,'Лампа накаливания'],[4,'Люминесцентный'],[5,'Вспышка'],[6,'Ручной WB'],[8,'Тень'],[WHITE_BALANCE_COLOR_TEMPERATURE,'Цветовая температура']]),
  pictureStyle: table([[0x81,'Стандарт'],[0x82,'Портрет'],[0x83,'Пейзаж'],[0x84,'Нейтральный'],[0x85,'Точный'],[0x86,'Монохром'],[0x87,'Авто'],[0x21,'Пользовательский 1'],[0x22,'Пользовательский 2'],[0x23,'Пользовательский 3']])
};
// Canon uses distinct IDs for some equal displayed values at 1/2 and 1/3 EV.
// Keep preset values portable across those camera step settings.
const EXTRA_VALUES={
  aperture:table([[0x0d,'f/1.2'],[0x15,'f/1.8'],[0x1c,'f/2.5'],[0x24,'f/3.5'],[0x2c,'f/4.5'],[0x34,'f/6.7'],[0x3c,'f/9.5'],[0x44,'f/13'],[0x4c,'f/19'],[0x54,'f/27']]),
  shutter:table([[0x15,'20″'],[0x1c,'10″'],[0x24,'6″'],[0x2c,'3″'],[0x34,'1.5″'],[0x3c,'0.7″'],[0x44,'0.3″'],[0x4c,'1/6'],[0x54,'1/10'],[0x5c,'1/20'],[0x64,'1/45'],[0x6c,'1/90'],[0x74,'1/180'],[0x7c,'1/350'],[0x84,'1/750'],[0x8c,'1/1500'],[0x94,'1/3000']]),
  compensation:table([[0xfc,'−½'],[0xf4,'−1½'],[0xec,'−2½'],[4,'+½'],[12,'+1½'],[20,'+2½']])
};
function valueLabel(key,value){
  if(key==='colorTemperature')return Number.isInteger(value)&&value>=0&&value<=0xffffffff?`${value} K`:undefined;
  return key==='imageQuality'?imageQualityLabel(value):[...(VALUES[key]||[]),...(EXTRA_VALUES[key]||[])].find(v=>v.value===value)?.label;
}
function resolveValue(key,requested,allowed){
  if(allowed.includes(requested))return requested;
  const label=valueLabel(key,requested);if(!label)return undefined;
  return allowed.find(value=>valueLabel(key,value)===label);
}
function choices(key, allowed, current) {
  return [...new Set([...(allowed || []), current].filter(v => v !== undefined))].map(value => ({value, label:valueLabel(key,value)||`0x${value.toString(16)}`}));
}
module.exports = { PROPS, VALUES, WHITE_BALANCE_COLOR_TEMPERATURE, choices, valueLabel, resolveValue };

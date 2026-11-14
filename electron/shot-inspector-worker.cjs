const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { previewSource } = require('./library.cjs');
const { readMetadata } = require('./metadata.cjs');

async function histogram(source) {
  const { data } = await sharp(source).autoOrient().resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = Array.from({ length: 3 }, () => Array(64).fill(0));
  for (let i = 0; i < data.length; i += 3) {
    for (let channel = 0; channel < 3; channel++) bins[channel][data[i + channel] >> 2]++;
  }
  return bins;
}

process.parentPort.once('message', async ({ data: { file } }) => {
  const send = data => process.parentPort.postMessage(data);
  const ext = path.extname(file).toLowerCase();
  let source;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw Error('Оригинал недоступен.');
    send({ fileAvailable: true });
    source = await previewSource(file);
    if (Buffer.isBuffer(source)) {
      // Normalize orientation of the embedded JPEG without resizing it.
      const info = await sharp(source).metadata();
      if (info.orientation > 1) source = await sharp(source).autoOrient().jpeg({ quality: 98, chromaSubsampling: '4:4:4' }).toBuffer();
      send({ image: { bytes: source, mime: 'image/jpeg', source: 'embedded' } });
    } else if (['.tif', '.tiff'].includes(ext)) {
      source = await sharp(source).autoOrient().toColourspace('srgb').png().toBuffer();
      send({ image: { bytes: source, mime: 'image/png', source: 'decoded' } });
    } else {
      const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext];
      if (!mime) throw Error('Формат изображения не поддерживается.');
      send({ image: { file, mime, source: 'original' } });
    }
  } catch (error) {
    source = null;
    send({ imageError: error.code === 'ENOENT' ? 'Оригинал перемещён или удалён.' : error.message });
  }
  try { send({ report: await readMetadata(file, { includeBinary: false }) }); }
  catch { send({ reportError: 'Не удалось прочитать данные оригинала.' }); }
  if (source) {
    try { send({ histogram: await histogram(source) }); } catch { /* Histogram is optional. */ }
  }
  send({ done: true });
});

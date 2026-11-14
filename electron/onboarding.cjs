const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STEPS = ['welcome', 'environment', 'discovery', 'connection', 'workspace', 'tutorial', 'ready'];
const TOPICS = ['live', 'capture', 'exposure', 'presets', 'library', 'sessions', 'inspector', 'lighting', 'remote'];

function onboardingState(value, established = false) {
  const object = value && typeof value === 'object' ? value : {};
  return {
    step: STEPS.includes(object.step) ? object.step : 'welcome',
    topic: TOPICS.includes(object.topic) ? object.topic : 'live',
    completed: typeof object.completed === 'boolean' ? object.completed : established,
    skipped: [...new Set(Array.isArray(object.skipped) ? object.skipped.filter(step => STEPS.includes(step)) : [])],
    environment: object.environment ?? null,
    report: object.report ?? null,
    workspace: object.workspace ?? null,
    connection: object.connection ?? null
  };
}

async function inspectFolder(folder) {
  if (!path.isAbsolute(folder)) throw Error('Выберите папку на компьютере.');
  const stat = await fs.stat(folder);
  if (!stat.isDirectory()) throw Error('Выбранный путь не является папкой.');
  const file = path.join(folder, '.apertrove-check-' + randomUUID());
  const handle = await fs.open(file, 'wx');
  try { await handle.writeFile('Apertrove'); }
  finally { try { await handle.close(); } finally { await fs.unlink(file); } }
  const statfs = await fs.statfs(folder).catch(() => null);
  return { folder, freeBytes: statfs ? statfs.bavail * statfs.bsize : null, checkedAt: new Date().toISOString() };
}

module.exports = { onboardingState, inspectFolder };

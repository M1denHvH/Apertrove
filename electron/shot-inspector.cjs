const path = require('node:path');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, clipboard, ipcMain, session, shell, utilityProcess } = require('electron');
const {frontendTarget,denyPermissions}=require('./frontend-policy.cjs');

const { windowOptions: appearanceWindowOptions } = require('./remote/appearance.js');

function createShotInspector({ latest, findPhoto, appearance, locale=()=> 'ru-RU', canRead, trackRead }) {
  let window = null;
  let lastId = null;
  let selected = null;
  let media = null;
  let worker = null;
  let reader = null;
  const isolatedSession = session.fromPartition('persist:apertrove-shot-inspector');
  denyPermissions(isolatedSession);

  const current = () => {
    const photo = latest();
    return { latest: photo ? { id: photo.id, name: photo.name } : null, appearance: appearance(), locale: locale() };
  };

  function stopReading() {
    worker?.kill();
    worker = null;
    reader?.destroy();
    reader = null;
    media = null;
  }

  function publish() {
    if (!window || window.isDestroyed()) return;
    const state = current();
    window.setBackgroundColor(appearanceWindowOptions(state.appearance).backgroundColor);
    lastId = state.latest?.id ?? null;
    const removed = selected && !findPhoto(selected.id) ? selected : null;
    if (removed) {
      stopReading();
      selected = null;
    }
    window.webContents.send('shot:state', { ...state, removedId: removed ? removed.id : null });
  }

  function open() {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return true;
    }
    const target=frontendTarget({isPackaged:app.isPackaged,devURL:process.env.FOCAL_DEV_URL,entry:'shot-inspector.html',distDir:path.join(__dirname,'..','dist')});
    const { backgroundColor, additionalArguments } = appearanceWindowOptions(appearance());
    const inspector = new BrowserWindow({
      title: 'Shot Inspector · Apertrove', width: 1160, height: 780, minWidth: 490, minHeight: 360,
      backgroundColor, icon: path.join(__dirname, '..', 'assets', 'icon.png'), show: false,
      webPreferences: { additionalArguments:[...additionalArguments,'--apertrove-locale='+locale()], session: isolatedSession, preload: path.join(__dirname, 'shot-inspector-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    window = inspector;
    lastId = current().latest?.id ?? null;
    inspector.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    inspector.webContents.on('will-navigate', event => event.preventDefault());
    inspector.once('ready-to-show', () => inspector.show());
    inspector.on('closed', () => {
      stopReading();
      selected = null;
      window = null;
    });
    const load=target.url?inspector.loadURL(target.url):inspector.loadFile(target.file);
    return load.then(() => true, error => { if (!inspector.isDestroyed()) inspector.destroy(); throw error; });
  }

  function view({ id, revision }) {
    if (id !== null && (!Number.isSafeInteger(revision) || typeof id !== 'string' || id.length > 128)) throw Error('Некорректный запрос кадра.');
    const photo = id === null ? null : findPhoto(id);
    if (id !== null && !photo) throw Error('Кадр больше недоступен.');
    if (photo && !canRead()) return { busy: true };
    stopReading();
    selected = photo ? { id, revision } : null;
    if (!photo) return;
    const job = utilityProcess.fork(path.join(__dirname, 'shot-inspector-worker.cjs'), [], { serviceName: 'Apertrove Shot Inspector', stdio: 'ignore' });
    worker = job;
    const send = data => {
      if (worker === job && window && !window.isDestroyed()) window.webContents.send('shot:details', { id, revision, ...data });
    };
    const exit = new Promise(resolve => job.once('exit', resolve));
    trackRead(exit);
    const timeout = setTimeout(() => {
      send({ error: 'Чтение кадра заняло слишком много времени.', done: true });
      if (worker === job) worker = null;
      job.kill();
    }, 20_000);
    job.on('exit', () => {
      clearTimeout(timeout);
      if (worker !== job) return;
      send({ error: 'Не удалось обработать кадр.', done: true });
      worker = null;
    });
    job.on('message', message => {
      if (worker !== job) return;
      if (message.image) {
        const { source, ...data } = message.image;
        const token = randomUUID();
        media = { ...data, token, id };
        send({ image: { url: `focal-asset://shot/${token}`, source } });
      } else send(message);
      if (message.done) {
        worker = null;
        job.kill();
      }
    });
    job.postMessage({ file: photo.path });
  }

  const registered=[];
  try{
  for (const [name, handler] of Object.entries({
    boot: current, view,
    reveal: async ({ id }) => {
      const photo = selected?.id === id && findPhoto(id);
      if (!photo || !(await fs.stat(photo.path).catch(() => null))?.isFile()) throw Error('Оригинал перемещён или удалён.');
      shell.showItemInFolder(photo.path);
    },
    copy: ({ text }) => {
      if (typeof text !== 'string' || text.length > 100_000) throw Error('Не удалось скопировать данные.');
      return clipboard.writeText(text);
    }
  })) {
    ipcMain.handle('shot:' + name, (event, args) => {
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Недопустимый источник.');
      return handler(args || {});
    });
    registered.push('shot:'+name);
  }
  isolatedSession.protocol.handle('focal-asset', image);
  }catch(error){
    for(const channel of registered)ipcMain.removeHandler(channel);
    throw error;
  }

  async function image(request) {
    const { pathname, hostname } = new URL(request.url);
    const asset = media;
    if (request.method !== 'GET' || !asset || hostname !== 'shot' || pathname !== '/' + asset.token || !findPhoto(asset.id) || !canRead()) return new Response(null, { status: 404 });
    const headers = { 'Content-Type': asset.mime, 'Cache-Control': 'no-store' };
    if (asset.bytes) return new Response(asset.bytes, { headers });
    reader?.destroy();
    const stream = createReadStream(asset.file);
    reader = stream;
    trackRead(new Promise(resolve => stream.once('close', () => {
      if (reader === stream) reader = null;
      resolve();
    })));
    return new Response(Readable.toWeb(stream), { headers });
  }

  return {
    open, close: () => window?.destroy(), publish,
    photoChanged() {
      if (window && (current().latest?.id ?? null) !== lastId) publish();
    }
  };
}

module.exports = { createShotInspector };

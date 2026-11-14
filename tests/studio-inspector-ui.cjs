const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const profile = path.join(root, 'qa', `inspector-${Date.now()}-profile`);
const output = path.join(root, 'qa', 'studio-inspector');

(async () => {
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const launcher = path.join(profile, 'launch.cjs');
  await fs.writeFile(launcher, `
    const {utilityProcess} = require('electron');
    const fork = utilityProcess.fork.bind(utilityProcess);
    utilityProcess.fork = (file, ...args) => {
      const job = fork(file, ...args);
      if (file.endsWith('camera-worker.cjs')) globalThis.fixtureCamera = job;
      return job;
    };
    require(${JSON.stringify(path.join(root, 'electron', 'main.cjs'))});
  `);
  const binary = process.env.FOCAL_BINARY;
  if (binary) {
    const capture = path.join(profile, 'package-smoke.jpg');
    await sharp({ create: { width: 900, height: 600, channels: 3, background: '#765658' } }).withExif({ IFD0: { Model: 'Packaged Canon fixture' } }).jpeg().toFile(capture);
    await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({
      sessions: [], presets: [], settings: {}, photos: [{ id: 'smoke', name: 'package-smoke.jpg', path: capture, cameraTransfer: true, size: (await fs.stat(capture)).size }]
    }));
  }
  const app = await _electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: [launcher] }),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FOCAL_TEST_DATA: profile } });
  const errors = [];
  try {
    const main = await app.firstWindow();
    main.on('pageerror', error => errors.push(error.message));
    await main.waitForSelector('.app-shell');
    if (binary) {
      await main.getByRole('button', { name: 'Библиотека', exact: true }).click();
      const opened = app.waitForEvent('window');
      await main.getByRole('button', { name: 'Открыть Shot Inspector', exact: true }).click();
      const inspector = await opened;
      await inspector.waitForFunction(() => document.querySelector('.shot-stage img')?.naturalWidth === 900);
      await inspector.getByText('Packaged Canon fixture', { exact: true }).waitFor();
      await inspector.getByText('Гистограмма RGB', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log('PASS packaged inspector HTML, isolated preload, original image and metadata worker');
      return;
    }
    await main.evaluate(() => window.focal.session({ name: 'Тест студии' }));
    await main.getByRole('button', { name: 'Lighting Studio', exact: true }).click();
    const color = main.getByRole('textbox', { name: 'Основной цвет HEX' });
    await color.fill('#FF0000');
    const wheel = main.locator('.lighting-wheel');
    await wheel.click({ position: { x: (await wheel.boundingBox()).width * .85, y: (await wheel.boundingBox()).height / 2 } });
    assert.notEqual(await color.inputValue(), '#FF0000');
    await color.fill('#2C93B8');
    await main.getByRole('button', { name: 'Сохранить палитру', exact: true }).click();
    await main.getByRole('button', { name: 'Схемы света', exact: true }).click();
    await main.getByRole('combobox', { name: 'Схема света' }).click();
    assert.equal(await main.getByRole('option').count(), 7);
    await main.getByRole('option', { name: 'Clamshell Lighting' }).click();
    await main.getByRole('button', { name: /Отражатель/ }).click();
    await main.getByText('Под подбородком, по оси', { exact: true }).waitFor();
    await main.screenshot({ path: path.join(output, 'lighting-scheme.png') });
    await main.getByRole('button', { name: 'Сценарии', exact: true }).click();
    await main.getByRole('button', { name: 'Colorful', exact: true }).click();
    await main.getByText(/Два RGB-источника/).waitFor();
    await main.getByRole('button', { name: /Настроить палитру/ }).click();
    assert.equal(await color.inputValue(), '#DB456B');
    await main.getByRole('button', { name: /^#2C93B8 ·/ }).click();
    assert.equal(await color.inputValue(), '#2C93B8');
    await main.screenshot({ path: path.join(output, 'lighting-palette.png') });
    await main.getByRole('button', { name: 'Библиотека', exact: true }).click();
    await main.getByRole('button', { name: 'Lighting Studio', exact: true }).click();
    await main.getByRole('button', { name: /^#2C93B8 ·/ }).click();
    assert.equal(await color.inputValue(), '#2C93B8');

    const open = async () => {
      const inspector = app.waitForEvent('window');
      await main.getByRole('button', { name: 'Открыть Shot Inspector', exact: true }).click();
      const page = await inspector;
      page.on('pageerror', error => errors.push(error.message));
      return page;
    };
    await main.getByRole('button', { name: 'Съёмка', exact: true }).click();
    let inspector = await open();
    await inspector.getByText('Нет полученных снимков', { exact: true }).waitFor();
    await main.getByRole('button', { name: 'Открыть Shot Inspector', exact: true }).click();
    assert.equal(app.windows().length, 2);
    assert.equal(await inspector.evaluate(() => typeof window.focal), 'undefined');
    assert.equal(await inspector.evaluate(() => typeof require), 'undefined');

    async function transfer(name, capture, dimensions = [2400, 1600], rights = 'Тестовые данные') {
      const file = path.join(profile, name);
      await sharp({ create: { width: dimensions[0], height: dimensions[1], channels: 3, background: '#66587d' } })
        .withExif({ IFD0: { Make: 'Canon', Model: 'Canon fixture', Copyright: rights }, IFD2: { FNumber: '28/10', ExposureTime: '1/125', ISO: '400' } })
        .jpeg().toFile(file);
      await app.evaluate((_electron, { file, capture }) => globalThis.fixtureCamera.emit('message', { event: 'photo', data: { path: file, capture } }), { file, capture });
      await main.waitForFunction(async name => (await window.focal.boot()).photos.some(photo => photo.name === name), name);
    }
    await transfer('card-only.jpg', false);
    await inspector.getByText('Нет полученных снимков', { exact: true }).waitFor();
    await transfer('capture-a.jpg', true, [2400, 1600], 'Fixture copyright');
    const image = inspector.locator('.shot-stage img');
    await inspector.waitForFunction(() => document.querySelector('.shot-stage img')?.naturalWidth === 2400);
    await inspector.getByText('Canon fixture', { exact: true }).waitFor();
    await inspector.getByText('Все доступные теги').click();
    await inspector.getByText('Fixture copyright', { exact: true }).waitFor();
    await inspector.getByText('Гистограмма RGB', { exact: true }).waitFor();
    await inspector.getByRole('button', { name: 'Копировать технические данные' }).click();
    assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /Canon fixture/);
    await inspector.getByRole('button', { name: '100%', exact: true }).click();
    await inspector.waitForFunction(() => Math.round(document.querySelector('.shot-stage img').getBoundingClientRect().width * devicePixelRatio) === 2400);
    const stage = inspector.locator('.shot-stage');
    const box = await stage.boundingBox();
    await inspector.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await inspector.mouse.down();
    await inspector.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 4 });
    await inspector.mouse.up();
    assert.match(await image.evaluate(node => node.style.transform), /80px, 50px/);
    await stage.dblclick();
    await inspector.getByRole('button', { name: 'Fit', exact: true, pressed: true }).waitFor();
    await stage.hover();
    await inspector.mouse.wheel(0, -130);
    await inspector.getByRole('button', { name: 'Fit', exact: true, pressed: false }).waitFor();
    await inspector.getByRole('button', { name: 'Закрепить кадр' }).click();
    await transfer('capture-b.jpg', true, [1300, 900]);
    assert.equal(await image.getAttribute('alt'), 'capture-a.jpg');
    await inspector.getByRole('button', { name: 'Следить за новыми кадрами' }).click();
    await inspector.waitForFunction(() => document.querySelector('.shot-stage img')?.naturalWidth === 1300);
    await main.evaluate(() => window.focal.settings({ theme: 'dark', design: 'classic' }));
    await inspector.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.design === 'classic');
    await inspector.getByRole('button', { name: '100%', exact: true }).click();
    const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('Shot Inspector')).id);
    await app.evaluate(({ BrowserWindow }, id) => { const win = BrowserWindow.fromId(id); win.setSize(600, 470); win.webContents.setZoomFactor(1.25); }, id);
    await inspector.waitForFunction(() => Math.abs(document.querySelector('.shot-stage img').getBoundingClientRect().width * devicePixelRatio - 1300) < 2);
    await inspector.getByRole('button', { name: 'Метаданные', exact: true }).click();
    await inspector.screenshot({ path: path.join(output, 'inspector-compact.png') });
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), id);
    inspector = await open();
    await inspector.waitForFunction(() => document.querySelector('.shot-stage img')?.naturalWidth === 1300);
    assert.equal(await inspector.getByRole('button', { name: 'Метаданные', exact: true, pressed: false }).count(), 1);
    assert.equal(await inspector.getByRole('button', { name: '100%', exact: true, pressed: true }).count(), 1);
    await inspector.getByRole('button', { name: 'Fit', exact: true }).click();
    await inspector.getByRole('button', { name: 'Метаданные', exact: true }).click();
    await inspector.getByText('Гистограмма RGB', { exact: true }).waitFor();
    const viewport = await inspector.evaluate(() => {
      const shell = document.querySelector('.shot-shell').getBoundingClientRect();
      const tools = document.querySelector('.shot-toolbar').lastElementChild.getBoundingClientRect();
      const metadata = document.querySelector('.shot-meta').getBoundingClientRect();
      return { width: innerWidth, shell: shell.right, tools: tools.right, metadata: metadata.right };
    });
    assert.ok(viewport.shell <= viewport.width + 1 && viewport.tools <= viewport.width && viewport.metadata <= viewport.width + 1, JSON.stringify(viewport));
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(win => win.getTitle().includes('Shot Inspector'));
      return (await window.webContents.capturePage()).toPNG().toString('base64');
    });
    await fs.writeFile(path.join(output, 'inspector.png'), Buffer.from(png, 'base64'));
    const removed = await main.evaluate(async () => (await window.focal.boot()).photos.find(photo => photo.name === 'capture-b.jpg').id);
    await inspector.getByRole('button', { name: 'Закрепить кадр' }).click();
    await main.evaluate(id => window.focal.photoDelete({ ids: [id] }), removed);
    await inspector.waitForFunction(() => document.querySelector('.shot-stage img')?.naturalWidth === 2400);
    assert.equal(await inspector.getByRole('button', { name: 'Закрепить кадр', pressed: false }).count(), 1);
    const closed = inspector.waitForEvent('close');
    await main.getByRole('button', { name: 'Закрыть приложение' }).click();
    await closed;
    assert.deepEqual(errors, []);
    console.log('PASS Lighting Studio and Shot Inspector through mocked transfers, native window, EXIF, zoom, pin, deletion and reopen');
  } finally { await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });

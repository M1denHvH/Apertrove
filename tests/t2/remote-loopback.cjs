'use strict';

// Opt-in T2 integration entry. This file intentionally is not a *.test.cjs glob.
// It imports the production Remote server, never the Electron/main/camera stack.
if (process.argv.length !== 3 || process.argv[2] !== '--allow-t2-loopback') {
  throw new Error('Explicit admission required: node --no-addons tests/t2/remote-loopback.cjs --allow-t2-loopback');
}
if (!process.execArgv.includes('--no-addons')) throw new Error('T2 requires --no-addons.');
if (process.execArgv.some(argument => argument !== '--no-addons' && !/^--max-old-space-size=(128|256)$/.test(argument))) throw new Error('Only reviewed Node flags --no-addons and optional --max-old-space-size=128/256 are admitted.');
if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('Clear NODE_OPTIONS and NODE_PATH before this T2 entry.');
if (!/^[0-9a-f]{40}$/i.test(process.env.APERTROVE_SOURCE_COMMIT || '')) throw new Error('Launcher must provide APERTROVE_SOURCE_COMMIT as a full40hex source commit.');
process.env.WS_NO_BUFFER_UTIL = '1';
process.env.WS_NO_UTF_8_VALIDATE = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const dns = require('node:dns');
const tls = require('node:tls');
const Module = require('node:module');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
assert.equal(require.main, module, 'Run this reviewed entry directly.');
assert.deepEqual(Object.keys(require.cache), [__filename], 'No project/preload module may execute before admission.');

const ROOT = path.resolve(__dirname, '..', '..');
const RESULT_DIR = path.join(ROOT, 'qa', 'integration');
const RESULT_FILE = path.join(RESULT_DIR, 'remote-results.json');
const WAIT_MS = 2000;
const WALL_MS = 30000;
const MAX_CLIENTS = 4;
const MAX_EVENTS = 128;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const startedAt = Date.now();
const checks = [];
const violations = [];
const expectedDenials = [];
let expectedDenial;
const graph = [];
const reads = new Set();
const sourceHashes = {};
const clients = new Set();
const sockets = new Set();
const outboundSockets = new Set();
const seenPorts = new Set();
const listens = [];
const timers = new Set();
const stats = { events: 0, sentMessages: 0, receivedMessages: 0, sentPings: 0, receivedPongs: 0, maxClients: 0, maxOutboundSockets: 0, httpRequests: 0, literalLookupCount: 0 };
const native = {
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  openSync: fs.openSync,
  closeSync: fs.closeSync,
  lookup: dns.lookup,
  lookupPromise: dns.promises.lookup,
  load: Module._load,
  resolve: Module._resolveFilename,
  listen: net.Server.prototype.listen,
  connect: net.Socket.prototype.connect
};
let remote;
let currentPort;
let activeHold;
let finished = false;

function relative(value) { return path.relative(ROOT, value).split(path.sep).join('/'); }
function normalized(value) {
  const filename = value instanceof URL ? fileURLToPath(value) : value;
  if (typeof filename !== 'string') throw new Error('Only explicit filesystem paths are allowed.');
  return path.resolve(filename).toLowerCase();
}
function forbidden(kind, detail) {
  const item = Object.freeze({ kind, detail: String(detail) });
  if (expectedDenial && expectedDenial.kind === item.kind && expectedDenial.detail === item.detail) {
    expectedDenials.push(item);
    const error = new Error('Expected T2 boundary refusal: ' + kind);
    error.code = 'T2_EXPECTED_DENIAL';
    throw error;
  }
  violations.push(item);
  throw new Error('T2 boundary violation: ' + kind + ': ' + item.detail);
}
function expectDenial(kind, detail, operation) {
  const before = expectedDenials.length;
  expectedDenial = { kind, detail: String(detail) };
  try { assert.throws(operation, error => error.code === 'T2_EXPECTED_DENIAL'); }
  finally { expectedDenial = undefined; }
  assert.equal(expectedDenials.length, before + 1, 'Exactly one expected refusal must be recorded.');
  assert.equal(violations.length, 0, 'Unexpected refusal during a negative admission probe.');
}
function countEvent(kind) {
  stats.events++;
  if (stats.events > MAX_EVENTS) forbidden('event-budget', kind);
}
function timer(callback, milliseconds) {
  const handle = setTimeout(() => { timers.delete(handle); callback(); }, milliseconds);
  timers.add(handle);
  return handle;
}
function clearTimer(handle) { clearTimeout(handle); timers.delete(handle); }
function delay(milliseconds) { return new Promise(resolve => timer(resolve, milliseconds)); }
function bounded(promise, label, milliseconds = WAIT_MS) {
  let handle;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => { handle = timer(() => reject(new Error('Timed out: ' + label)), milliseconds); })
  ]).finally(() => clearTimer(handle));
}
async function check(name, operation) {
  const start = Date.now();
  await operation();
  assert.equal(violations.length, 0, 'A caught forbidden attempt is still a failure.');
  checks.push({ name, status: 'passed', elapsedMs: Date.now() - start });
}

const appModules = ['electron/remote-server.cjs', 'electron/i18n/runtime.js', 'electron/remote/appearance.js'];
const wsModules = ['index.js', 'lib/buffer-util.js', 'lib/constants.js', 'lib/event-target.js', 'lib/extension.js', 'lib/limiter.js', 'lib/permessage-deflate.js', 'lib/receiver.js', 'lib/sender.js', 'lib/stream.js', 'lib/subprotocol.js', 'lib/validation.js', 'lib/websocket-server.js', 'lib/websocket.js'].map(file => 'node_modules/ws/' + file);
const assets = [
  ['/', 'electron/remote/hud.html', 'text/html'],
  ['/hud.css', 'electron/remote/hud.css', 'text/css'],
  ['/hud.js', 'electron/remote/hud.js', 'text/javascript'],
  ['/focus-overlay.js', 'electron/remote/focus-overlay.js', 'text/javascript'],
  ['/composition-overlay.js', 'electron/remote/composition-overlay.js', 'text/javascript'],
  ['/i18n.js', 'electron/i18n/runtime.js', 'text/javascript'],
  ['/locales/ru-RU.json', 'electron/i18n/locales/ru-RU.json', 'application/json'],
  ['/locales/en-US.json', 'electron/i18n/locales/en-US.json', 'application/json'],
  ['/appearance.js', 'electron/remote/appearance.js', 'text/javascript'],
  ['/appearance.css', 'electron/remote/appearance.css', 'text/css'],
  ['/lcd.js', 'electron/remote/lcd.js', 'text/javascript']
];
for (const subset of ['latin', 'cyrillic']) {
  for (const weight of [400, 500, 600, 700]) {
    assets.push(['/fonts/manrope-' + subset + '-' + weight + '.woff2', 'node_modules/@fontsource/manrope/files/manrope-' + subset + '-' + weight + '-normal.woff2', 'font/woff2']);
  }
}
const modulePaths = new Set([...appModules, ...wsModules].map(file => normalized(path.join(ROOT, file))));
const readable = new Set([
  __filename,
  ...appModules.map(file => path.join(ROOT, file)),
  ...wsModules.map(file => path.join(ROOT, file)),
  ...assets.map(([, file]) => path.join(ROOT, file)),
  path.join(ROOT, 'package.json'), path.join(ROOT, 'package-lock.json'),
  path.join(ROOT, 'node_modules', 'ws', 'package.json'),
  path.join(ROOT, 'node_modules', 'vite', 'package.json')
].map(normalized));
const coreModules = new Set(['assert/strict', 'buffer', 'crypto', 'dns', 'events', 'fs', 'http', 'https', 'module', 'net', 'os', 'path', 'querystring', 'stream', 'tls', 'url', 'util', 'zlib']);

// ws catches failures from optional addons; the append-only violation list makes
// even a caught import/dlopen attempt fatal at every checkpoint and final result.
Module._load = function guardedLoad(request, parent, isMain) {
  const name = String(request).replace(/^node:/, '');
  if (/\.node$/i.test(name)) forbidden('native-addon', name);
  if (/^(?:electron(?:\/|$)|koffi(?:\/|$)|sharp(?:\/|$)|bufferutil(?:\/|$)|utf-8-validate(?:\/|$)|child_process$|worker_threads$|cluster$)/.test(name)) forbidden('module', name);
  if (Module.builtinModules.includes(name) || Module.builtinModules.includes('node:' + name)) {
    if (!coreModules.has(name)) forbidden('unreviewed-core-module', name);
    graph.push({ from: parent && parent.filename ? relative(parent.filename) : '<entry>', to: 'node:' + name });
    return native.load.apply(this, arguments);
  }
  const resolved = native.resolve.call(Module, request, parent, isMain);
  if (/\.node$/i.test(resolved)) forbidden('native-addon', relative(resolved));
  if (!modulePaths.has(normalized(resolved))) forbidden('unreviewed-source', relative(resolved));
  graph.push({ from: parent && parent.filename ? relative(parent.filename) : '<entry>', to: relative(resolved) });
  return native.load.apply(this, arguments);
};
Module._extensions['.node'] = (target, filename) => forbidden('native-extension', filename);
process.dlopen = (target, filename) => forbidden('dlopen', filename);

function admitRead(filename) {
  const value = normalized(filename);
  if (!readable.has(value)) forbidden('filesystem-read', value);
  reads.add(relative(path.resolve(filename instanceof URL ? fileURLToPath(filename) : filename)));
}
for (const method of ['readFileSync', 'readFile', 'createReadStream', 'statSync', 'stat', 'lstatSync', 'lstat', 'accessSync', 'access', 'existsSync', 'realpathSync', 'realpath']) {
  if (typeof fs[method] !== 'function') continue;
  const original = fs[method];
  fs[method] = function guardedRead(filename, ...args) { admitRead(filename); return original.call(this, filename, ...args); };
}
for (const method of ['openSync', 'open']) {
  const original = fs[method];
  fs[method] = function guardedOpen(filename, flags, ...args) {
    admitRead(filename);
    if (flags !== 'r' && flags !== 'rs' && flags !== 'sr' && flags !== 0) forbidden('filesystem-open-flags', flags);
    return original.call(this, filename, flags, ...args);
  };
}
for (const method of ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'createWriteStream', 'mkdirSync', 'mkdir', 'rmSync', 'rm', 'rmdirSync', 'rmdir', 'unlinkSync', 'unlink', 'renameSync', 'rename', 'copyFileSync', 'copyFile', 'cpSync', 'cp', 'readdirSync', 'readdir', 'opendirSync', 'opendir', 'watch', 'watchFile', 'chmodSync', 'chmod', 'chownSync', 'chown', 'linkSync', 'link', 'symlinkSync', 'symlink', 'truncateSync', 'truncate', 'utimesSync', 'utimes']) {
  if (typeof fs[method] === 'function') fs[method] = (...args) => forbidden('filesystem-operation', method + ': ' + String(args[0]));
}
for (const method of Object.keys(fs.promises)) {
  if (typeof fs.promises[method] === 'function') fs.promises[method] = (...args) => forbidden('filesystem-promise', method + ': ' + String(args[0]));
}

// No inspection of real LAN adapters is performed, including default selection.
os.networkInterfaces = () => ({ loopback: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] });
for (const method of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) {
  if (typeof dns[method] === 'function') dns[method] = function guardedDns(value, ...args) {
    if (method === 'lookup' && value === '127.0.0.1') {
      stats.literalLookupCount++;
      const options=typeof args[0]==='function'?{}:args[0];
      const callback=typeof args[0]==='function'?args[0]:args[1];
      return process.nextTick(()=>options?.all?callback(null,[{address:value,family:4}]):callback(null,value,4));
    }
    return forbidden('dns', value);
  };
  if (dns.promises && typeof dns.promises[method] === 'function') dns.promises[method] = function guardedDnsPromise(value, ...args) {
    if (method === 'lookup' && value === '127.0.0.1') { stats.literalLookupCount++; return Promise.resolve(args[0]?.all?[{address:value,family:4}]:{address:value,family:4}); }
    return forbidden('dns-promise', value);
  };
}
tls.connect = () => forbidden('tls-connect', 'TLS is outside this loopback HTTP test.');
net.Server.prototype.listen = function guardedListen(...args) {
  const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { port: args[0], host: args[1] };
  if (Number(options.port) !== 0 || options.host !== '127.0.0.1' || options.path) forbidden('listen', JSON.stringify(options));
  if (listens.length >= 2) forbidden('listen-budget', 'Only initial start and token-rotation restart are admitted.');
  const entry = { host: options.host, requestedPort: 0 };
  listens.push(entry);
  this.once('listening', () => { entry.port = this.address().port; seenPorts.add(entry.port); });
  this.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  return native.listen.apply(this, args);
};
net.Socket.prototype.connect = function guardedConnect(...args) {
  // net.createConnection passes Node's already-normalized [options, callback]
  // argument array into Socket.connect on supported Node versions.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === 'object' && first !== null ? first : { port: first, host: args[1] };
  const port = Number(options.port);
  if (options.host !== '127.0.0.1' || !seenPorts.has(port) || options.path) forbidden('connect', JSON.stringify({ host: options.host, port, path: options.path }));
  if (outboundSockets.size >= MAX_CLIENTS) forbidden('connection-budget', 'More than four simultaneous outbound connections.');
  outboundSockets.add(this);
  stats.maxOutboundSockets = Math.max(stats.maxOutboundSockets, outboundSockets.size);
  this.once('close', () => outboundSockets.delete(this));
  return native.connect.apply(this, args);
};

function writeResult(status, error) {
  // The only writable paths: these two ignored QA directories and this JSON file.
  for (const directory of [path.join(ROOT, 'qa'), RESULT_DIR]) {
    try { native.mkdirSync(directory); } catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
  }
  const output = {
    suite: 'T2 remote-loopback', status,
    sourceCommit: { value: process.env.APERTROVE_SOURCE_COMMIT.toLowerCase(), provenance: 'launcher-provided; validated40hex; not independently resolved by this no-spawn entry' },
    environment: { node: process.version, platform: process.platform, arch: process.arch, execArgv: [...process.execArgv], argv: [...process.argv] },
    elapsedMs: Date.now() - startedAt,
    admission: { cliGate: '--allow-t2-loopback', noAddons: true, realInterfacesRead: false, nativeOptionalImportsDisabled: true, host: '127.0.0.1', fakeCallbacksOnly: true, mainOrElectronImported: false },
    limits: { wallMs: WALL_MS, ordinaryWaitMs: WAIT_MS, authTimeoutWaitMs: 6500, maxConcurrentClients: MAX_CLIENTS, maxObservedEvents: MAX_EVENTS, maxFixtureBytes: 17 * 1024, pausedReadMs: 250, pingFrames: 32 },
    dependencyVersions: { ws: '8.23.0', vite: '6.4.6' },
    checks, stats, listens, expectedDenials, forbiddenAttempts: violations,
    sourceHashes,
    loadedGraph: graph,
    readPaths: [...reads].sort(),
    cleanup: { running: remote ? remote.info().running : false, liveClients: [...clients].filter(client => client.ws.readyState !== 3).length, liveOutboundSockets: outboundSockets.size, liveAcceptedSockets: sockets.size },
    limitation: 'The capped Ping/slow-reader case verifies compatibility and cleanup; it does not reproduce resource exhaustion or prove the automatic-Pong queue limit was reached.',
    ...(error ? { error: { name: error.name, message: error.message, stack: error.stack } } : {})
  };
  const descriptor = native.openSync(RESULT_FILE, 'w');
  try { native.writeFileSync(descriptor, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8' }); }
  finally { native.closeSync(descriptor); }
  return output;
}
const hardDeadline = setTimeout(() => {
  if (finished) return;
  violations.push({ kind: 'wall-budget', detail: '30-second hard deadline exceeded.' });
  for (const client of clients) client.ws.terminate();
  for (const socket of [...sockets, ...outboundSockets]) socket.destroy();
  try { writeResult('failed', new Error('30-second hard deadline exceeded.')); } finally { process.exit(1); }
}, Math.max(1, WALL_MS - (Date.now() - startedAt)));
function fatalExit(error) {
  if (finished) return;
  finished = true;
  clearTimeout(hardDeadline);
  for (const client of clients) client.ws.terminate();
  for (const socket of [...sockets, ...outboundSockets]) socket.destroy();
  try { writeResult('failed', error instanceof Error ? error : new Error(String(error))); }
  finally { process.exit(1); }
}
process.on('uncaughtException', fatalExit);
process.on('unhandledRejection', fatalExit);

function request(route, { method = 'GET', headers = {}, body, port = currentPort } = {}) {
  stats.httpRequests++;
  return bounded(new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, agent: false, headers: { Connection: 'close', ...headers } });
    req.on('error', reject);
    req.setTimeout(WAIT_MS, () => req.destroy(new Error('HTTP timeout: ' + route)));
    req.on('response', res => {
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_RESPONSE_BYTES) req.destroy(new Error('HTTP response budget exceeded.')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), json() { return JSON.parse(this.bytes.toString('utf8')); } }));
    });
    req.end(body);
  }), 'HTTP ' + method + ' ' + route);
}
let WebSocket;
function makeClient({ route = '/ws', origin, headers = {} } = {}) {
  const live = [...clients].filter(client => client.ws.readyState !== 3).length;
  assert.ok(live < MAX_CLIENTS, 'WebSocket concurrency budget.');
  const ws = new WebSocket('ws://127.0.0.1:' + currentPort + route, { origin, headers, perMessageDeflate: false, handshakeTimeout: WAIT_MS, maxPayload: MAX_RESPONSE_BYTES });
  const queues = new Map();
  const waiters = [];
  function receive(event, args) {
    if (event === 'message') { stats.receivedMessages++; countEvent('server message'); }
    if (event === 'pong') { stats.receivedPongs++; countEvent('server Pong'); }
    const index = waiters.findIndex(waiter => waiter.event === event && waiter.predicate(...args));
    if (index >= 0) { const [waiter] = waiters.splice(index, 1); clearTimer(waiter.timer); waiter.resolve(args); }
    else { const queue = queues.get(event) || []; queue.push(args); queues.set(event, queue); }
  }
  for (const event of ['open', 'message', 'pong', 'close', 'error']) ws.on(event, (...args) => receive(event, args));
  const client = {
    ws,
    wait(event, predicate = () => true, milliseconds = WAIT_MS) {
      const queue = queues.get(event) || [];
      const index = queue.findIndex(args => predicate(...args));
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { event, predicate, resolve };
        waiter.timer = timer(() => { const position = waiters.indexOf(waiter); if (position >= 0) waiters.splice(position, 1); reject(new Error('WebSocket timeout: ' + event)); }, milliseconds);
        waiters.push(waiter);
      });
    },
    send(value) { stats.sentMessages++; countEvent('client message'); ws.send(typeof value === 'string' ? value : JSON.stringify(value)); },
    json(type, id) { return this.wait('message', (bytes, binary) => { if (binary) return false; try { const message = JSON.parse(bytes.toString()); return message.type === type && (id === undefined || message.id === id); } catch { return false; } }).then(([bytes]) => JSON.parse(bytes.toString())); }
  };
  clients.add(client);
  stats.maxClients = Math.max(stats.maxClients, live + 1);
  return client;
}
async function authenticate(key, options = {}) {
  const client = makeClient(options);
  await client.wait('open');
  const state = client.json('state');
  client.send({ type: 'auth', key });
  assert.equal((await state).data.camera.model, 'T2 synthetic camera');
  return client;
}
async function terminate(client) {
  if (!client || client.ws.readyState === 3) return;
  const closed = client.wait('close');
  client.ws.terminate();
  await closed;
  await delay(5);
}
async function cleanup() {
  if (activeHold) { activeHold(); activeHold = null; }
  for (const client of clients) if (client.ws.readyState !== 3) client.ws.terminate();
  for (const socket of [...sockets, ...outboundSockets]) socket.destroy();
  if (remote) await bounded(remote.stop(), 'Remote stop');
  await delay(15);
  for (const handle of [...timers]) clearTimer(handle);
}

async function main() {
  await check('admission: module/native/write sentinels demonstrably refuse before execution or I/O', async () => {
    for (const name of ['electron', 'koffi', 'node:child_process', 'node:worker_threads']) {
      expectDenial('module', name.replace(/^node:/, ''), () => require(name));
    }
    const nativeProbe = path.join(ROOT, 'qa', 'integration', 'denied-probe.node');
    expectDenial('native-addon', nativeProbe, () => require(nativeProbe));
    expectDenial('dlopen', nativeProbe, () => process.dlopen({}, nativeProbe));
    const deniedWrite = path.join(RESULT_DIR, 'denied-probe.json');
    expectDenial('filesystem-operation', 'writeFileSync: ' + deniedWrite, () => fs.writeFileSync(deniedWrite, 'must never be written'));
    assert.equal(expectedDenials.length, 7);
  });
  await check('admission: exact dependency versions and reviewed source closure', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const wsPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/ws/package.json'), 'utf8'));
    const vitePackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/vite/package.json'), 'utf8'));
    assert.equal(wsPackage.version, '8.23.0');
    assert.equal(vitePackage.version, '6.4.6');
    assert.equal(lock.packages['node_modules/ws'].version, wsPackage.version);
    assert.equal(lock.packages['node_modules/vite'].version, vitePackage.version);
    assert.ok(['8.23.0', '^8.23.0', '~8.23.0'].includes(manifest.dependencies.ws));
    assert.ok(['6.4.6', '^6.4.6', '~6.4.6'].includes(manifest.devDependencies.vite));
    for (const filename of [relative(__filename), ...appModules, ...wsModules, 'package.json', 'package-lock.json']) {
      sourceHashes[filename] = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, filename))).digest('hex');
    }
    const wsServer = fs.readFileSync(path.join(ROOT, 'node_modules/ws/lib/websocket-server.js'), 'utf8');
    assert.match(wsServer, /maxPendingAutoPongs:\s*60/);
    ({ WebSocket } = require('ws'));
  });

  const { createRemoteServer, localInterfaces, sameSecret } = require(path.join(ROOT, 'electron/remote-server.cjs'));
  const bytes = Buffer.from([0xff, 0xd8, 0x54, 0x32, 0x00, 0xff, 0xd9]);
  const oversized = Buffer.alloc(17 * 1024, 0x20);
  Buffer.from('{"name":"capture","args":{}}').copy(oversized);
  const calls = [];
  const state = {
    locale: 'en-US', camera: { connected: false, live: false, model: 'T2 synthetic camera' },
    appearance: { theme: 'system', resolvedTheme: 'dark', systemTheme: 'dark', accentColor: '#669DD8', design: 'classic', performanceMode: true, secret: 't2-private-sentinel', captureFolder: 't2-private-sentinel' },
    session: { name: 'Synthetic T2 session', count: 0 }, settings: { sdkDir: 't2-private-sentinel' }, photos: ['t2-private-sentinel']
  };
  let holdStarted;
  remote = createRemoteServer({
    getState: () => state,
    command: async (name, args) => {
      calls.push({ name, args });
      if (name === 'property' && args.hold === true) { holdStarted(); await new Promise(resolve => { activeHold = resolve; }); activeHold = null; }
      return { syntheticOnly: true, name };
    },
    getPhoto: async id => id === 'fixture' ? bytes : null,
    log: () => {}, onClients: () => {}
  });
  await check('binding: fixed loopback adapter fixture and invalid options rejected before listen', async () => {
    assert.deepEqual(localInterfaces().map(item => item.address), ['127.0.0.1']);
    assert.ok(sameSecret('synthetic', 'synthetic'));
    assert.equal(sameSecret('synthetic', 'wrong'), false);
    await assert.rejects(remote.start({ host: '0.0.0.0', port: 0 }));
    await assert.rejects(remote.start({ host: '127.0.0.1', port: 80 }));
    await assert.rejects(remote.start({ host: '127.0.0.1', port: 65536 }));
    assert.equal(listens.length, 0);
  });
  let info = await bounded(remote.start({ host: '127.0.0.1', port: 0 }), 'Remote start');
  currentPort = info.port;
  const key = new URL(info.url).hash.slice('#key='.length);
  const auth = { Authorization: 'Bearer ' + key };
  const origin = 'http://127.0.0.1:' + currentPort;

  await check('frontend: every explicit static route matches reviewed bytes and security headers', async () => {
    const routes = new Set(assets.map(([route]) => route));
    for (const [route, filename, contentType] of assets) {
      const expected = fs.readFileSync(path.join(ROOT, filename));
      assert.ok(expected.length > 0 && expected.length <= MAX_RESPONSE_BYTES, 'Bounded reviewed asset: ' + route);
      sourceHashes[filename] = crypto.createHash('sha256').update(expected).digest('hex');
      const response = await request(route);
      assert.equal(response.status, 200, route);
      assert.ok(response.headers['content-type'].startsWith(contentType), route);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
      assert.match(response.headers['content-security-policy'], /script-src 'self'/);
      assert.deepEqual(response.bytes, expected, route);
      if (route === '/') for (const match of expected.toString().matchAll(/(?:src|href)="(\/[^"]+)"/g)) assert.ok(routes.has(match[1]), 'Every HUD reference has an explicit route.');
    }
    const appearance = (await request('/appearance.json')).json();
    assert.deepEqual(Object.keys(appearance).sort(), ['accentColor', 'design', 'onAccent', 'performanceMode', 'resolvedTheme', 'systemTheme', 'theme'].sort());
    assert.equal(appearance.accentColor, '#669dd8');
    assert.equal(appearance.resolvedTheme, 'dark');
    assert.ok(!JSON.stringify(appearance).includes('t2-private-sentinel'));
    assert.deepEqual((await request('/locale.json')).json(), { locale: 'en-US' });
    assert.equal((await request('/fonts/unknown.woff2')).status, 401);
    assert.equal((await request('/%2e%2e/package.json', { headers: auth })).status, 404);
  });
  await check('HTTP: bearer, Host, Origin, command allowlist, content type and 17KiB payload', async () => {
    assert.equal((await request('/api/state')).status, 401);
    assert.equal((await request('/api/frame')).status, 401);
    assert.equal((await request('/api/photo/fixture')).status, 401);
    assert.equal((await request('/api/state', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.deepEqual((await request('/api/state', { headers: { ...auth, Origin: origin } })).json(), state);
    assert.equal((await request('/api/state', { headers: { ...auth, Host: 'unrelated.example' } })).status, 403);
    assert.equal((await request('/api/state', { headers: { ...auth, Origin: 'http://unrelated.example' } })).status, 403);
    assert.equal((await request('/api/state', { headers: { ...auth, Origin: origin.replace('http:', 'https:') } })).status, 403);
    const before = calls.length;
    let response = await request('/api/command', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ name: 'property', args: { key: 'iso', value: 72 } }) });
    assert.equal(response.status, 200);
    assert.deepEqual(calls[before], { name: 'property', args: { key: 'iso', value: 72 } });
    response = await request('/api/command', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"name":"chooseFolder","args":{"path":"synthetic-only"}}' });
    assert.equal(response.status, 400);
    assert.equal((await request('/api/command', { method: 'POST', headers: auth, body: '{}' })).status, 415);
    assert.equal((await request('/api/command', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: oversized })).status, 400);
    assert.equal(calls.length, before + 1, 'Rejected requests never reach callback.');
  });
  await check('WebSocket: invalid key and non-auth command close1008; Host/Origin/path upgrade rejected', async () => {
    for (const message of [{ type: 'auth', key: 'invalid' }, { type: 'command', id: 0, name: 'capture' }]) {
      const client = makeClient({ origin });
      await client.wait('open');
      client.send(message);
      assert.equal((await client.wait('close'))[0], 1008);
      await delay(5);
    }
    for (const options of [{ headers: { Host: 'unrelated.example' } }, { origin: 'http://unrelated.example' }, { route: '/not-ws', origin }]) {
      const client = makeClient(options);
      await client.wait('close');
      assert.notEqual(client.ws.readyState, WebSocket.OPEN);
      await delay(5);
    }
  });
  await check('WebSocket: unauthenticated idle client closes1008 within bounded auth timeout', async () => {
    const client = makeClient({ origin });
    await client.wait('open');
    assert.equal((await client.wait('close', () => true, 6500))[0], 1008);
    await delay(5);
  });
  let client = await authenticate(key, { origin });
  await check('WebSocket: allowed synthetic command, command denylist, JSON ping and malformed/binary errors', async () => {
    client.send({ type: 'command', id: 1, name: 'capture', args: {} });
    assert.deepEqual(await client.json('result', 1), { type: 'result', id: 1, result: { syntheticOnly: true, name: 'capture' } });
    const before = calls.length;
    client.send({ type: 'command', id: 2, name: 'chooseFolder' });
    assert.equal(typeof (await client.json('result', 2)).error, 'string');
    assert.equal(calls.length, before);
    client.send({ type: 'ping', at: 42 });
    assert.deepEqual(await client.json('pong'), { type: 'pong', at: 42 });
    client.send('{');
    assert.equal(typeof (await client.json('error')).error, 'string');
    stats.sentMessages++; countEvent('client binary message'); client.ws.send(bytes, { binary: true });
    assert.equal(typeof (await client.json('error')).error, 'string');
  });
  await check('WebSocket: in-flight command is serialized without a second callback', async () => {
    const begun = new Promise(resolve => { holdStarted = resolve; });
    const before = calls.length;
    client.send({ type: 'command', id: 3, name: 'property', args: { hold: true } });
    await bounded(begun, 'controlled synthetic command start');
    client.send({ type: 'command', id: 4, name: 'listCameras' });
    assert.equal(typeof (await client.json('result', 4)).error, 'string');
    assert.equal(calls.length, before + 1);
    activeHold();
    assert.equal((await client.json('result', 3)).result.syntheticOnly, true);
  });
  await check('media: exact synthetic JPEG, focus/state messages, photo404 and stale frame cleared', async () => {
    assert.equal((await request('/api/frame', { headers: auth })).status, 204);
    state.camera.live = true;
    remote.publishFrame(bytes);
    assert.deepEqual((await client.wait('message', (value, binary) => binary))[0], bytes);
    const frame = await request('/api/frame', { headers: auth });
    assert.equal(frame.headers['content-type'], 'image/jpeg');
    assert.deepEqual(frame.bytes, bytes);
    const photo = await request('/api/photo/fixture', { headers: auth });
    assert.equal(photo.headers['content-type'], 'image/jpeg');
    assert.deepEqual(photo.bytes, bytes);
    assert.equal((await request('/api/photo/missing', { headers: auth })).status, 404);
    remote.publishFocus({ syntheticOnly: true, x: 10, y: 20 });
    assert.deepEqual((await client.json('focus')).data, { syntheticOnly: true, x: 10, y: 20 });
    state.camera.live = false;
    remote.publishState();
    assert.equal((await client.json('state')).data.camera.live, false);
    assert.equal((await request('/api/frame', { headers: auth })).status, 204);
  });
  await check('WebSocket: one17KiB text payload closes1009 without command callback', async () => {
    const before = calls.length;
    stats.sentMessages++; countEvent('client oversized message'); client.ws.send(oversized, { binary: false });
    assert.equal((await client.wait('close'))[0], 1009);
    assert.equal(calls.length, before);
    await delay(5);
  });
  client = await authenticate(key); // Missing Origin is supported for a native loopback client.
  await check('protocol Ping: fixed32x125B slow-reader batch and responsive normal peer', async () => {
    const slow = makeClient({ origin });
    await slow.wait('open');
    const pingBytes = Buffer.alloc(125, 0x54);
    slow.ws.pause();
    try {
      for (let index = 0; index < 32; index++) { stats.sentPings++; countEvent('client protocol Ping'); slow.ws.ping(pingBytes); }
      client.send({ type: 'ping', at: 99 });
      assert.deepEqual(await client.json('pong'), { type: 'pong', at: 99 });
      await delay(250);
    } finally { slow.ws.resume(); }
    for (let index = 0; index < 32; index++) assert.deepEqual((await slow.wait('pong'))[0], pingBytes);
    await terminate(slow);
  });
  await check('stop: clients close, state clears, and old listener refuses connections', async () => {
    await bounded(remote.stop(), 'first Remote stop');
    await client.wait('close');
    assert.deepEqual(remote.info(), { running: false, host: null, port: null, clients: 0, url: null });
    await delay(15);
    await bounded(new Promise((resolve, reject) => {
      const probe = net.createConnection({ host: '127.0.0.1', port: currentPort });
      probe.once('connect', () => { probe.destroy(); reject(new Error('Stopped listener accepted a connection.')); });
      probe.once('error', error => { if (error.code === 'ECONNREFUSED') resolve(); else reject(error); });
    }), 'closed listener refusal');
    await delay(5);
  });
  await check('restart: token rotates and old HTTP/WebSocket credentials are rejected', async () => {
    info = await bounded(remote.start({ host: '127.0.0.1', port: 0 }), 'Remote restart');
    currentPort = info.port;
    const newKey = new URL(info.url).hash.slice('#key='.length);
    assert.ok(newKey !== key, 'Token must rotate; token values are not written to results.');
    assert.equal((await request('/api/state', { headers: auth })).status, 401);
    assert.equal((await request('/api/state', { headers: { Authorization: 'Bearer ' + newKey } })).status, 200);
    const fresh = await authenticate(newKey, { origin: 'http://127.0.0.1:' + currentPort });
    await terminate(fresh);
    const stale = makeClient({ origin: 'http://127.0.0.1:' + currentPort });
    await stale.wait('open');
    stale.send({ type: 'auth', key });
    assert.equal((await stale.wait('close'))[0], 1008);
    await delay(5);
    assert.equal((await request('/api/frame', { headers: { Authorization: 'Bearer ' + newKey } })).status, 204);
  });
}

(async () => {
  let failure;
  try { await main(); } catch (error) { failure = error; }
  try {
    await cleanup();
    assert.equal(violations.length, 0, 'No forbidden attempts, including caught fallbacks.');
    assert.equal(remote ? remote.info().running : false, false);
    assert.equal([...clients].filter(client => client.ws.readyState !== 3).length, 0);
    assert.equal(outboundSockets.size, 0);
    assert.equal(sockets.size, 0);
  } catch (error) { failure ||= error; }
  finished = true;
  clearTimeout(hardDeadline);
  try {
    const result = writeResult(failure ? 'failed' : 'passed', failure);
    process.stdout.write(JSON.stringify({ suite: result.suite, status: result.status, checks: checks.length, elapsedMs: result.elapsedMs, result: relative(RESULT_FILE) }) + '\n');
  } catch (error) { failure ||= error; process.stderr.write(error.message + '\n'); }
  if (failure) { process.stderr.write(failure.message + '\n'); process.exitCode = 1; }
})();

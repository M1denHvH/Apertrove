const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

function peArchitecture(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(64);
    if (fs.readSync(fd, header, 0, 64, 0) !== 64 || header.toString('ascii', 0, 2) !== 'MZ') return 'invalid';
    const pe = Buffer.alloc(6);
    if (fs.readSync(fd, pe, 0, 6, header.readUInt32LE(60)) !== 6 || pe.readUInt32LE(0) !== 0x4550) return 'invalid';
    return ({ 0x8664: 'x64', 0x14c: 'x86', 0xaa64: 'arm64' })[pe.readUInt16LE(4)] || 'unknown';
  } finally { fs.closeSync(fd); }
}

function sdkCandidates(custom) {
  const programs = process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files';
  const programs32 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const roots = [
    [custom, 'Выбранная папка'], [process.env.EDSDK_DIR, 'EDSDK_DIR'],
    [path.join(programs, 'Canon', 'EOS Utility', 'EU3'), 'EOS Utility'],
    [path.join(programs, 'Canon', 'EOS Utility'), 'EOS Utility'],
    [path.join(programs, 'Canon', 'Picture Style Editor'), 'Picture Style Editor'],
    [path.join(programs, 'Canon', 'EOS Webcam Utility'), 'EOS Webcam Utility'],
    [path.join(programs32, 'Canon', 'EOS Network Setting Tool', 'runtimes', 'windows', 'native'), 'EOS Network Setting Tool'],
    [path.join(__dirname, '..', 'sdk'), 'Локальный SDK']
  ];
  const seen = new Set();
  return roots.flatMap(([root, source]) => {
    if (!root || !path.isAbsolute(root)) return [];
    const file = path.extname(root).toLowerCase() === '.dll' ? root : path.join(root, 'EDSDK.dll');
    if (seen.has(file.toLowerCase())) return [];
    seen.add(file.toLowerCase());
    try { return [{ file, source, architecture: peArchitecture(file) }]; }
    catch (error) { return error.code === 'ENOENT' && root !== custom ? [] : [{ file, source, architecture: error.code === 'ENOENT' ? 'missing' : 'unreadable' }]; }
  });
}

async function fileVersion(file) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:APERTROVE_SDK_FILE).VersionInfo.FileVersion'], {
      env: { ...process.env, APERTROVE_SDK_FILE: file }, windowsHide: true, timeout: 4000, maxBuffer: 8192
    });
    return stdout.trim() || null;
  } catch { return null; }
}

module.exports = { peArchitecture, sdkCandidates, fileVersion };

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const yazl = require('yazl');
const ini = require('../src/main/ini');
const graphics = require('../src/main/graphics');
const { parsePatchPage, installedCsp, compareVersions, CspManager } = require('../src/main/csp');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lks-gfx-'));

test('parses the official CSP page (recommended / latest / list)', () => {
  const v = parsePatchPage(fs.readFileSync(path.join(__dirname, 'fixtures', 'csp-page.html'), 'utf8'));
  assert.strictEqual(v.recommended, '0.2.11');
  assert.strictEqual(v.latest, '0.3.1');
  assert.ok(v.all.length > 10);
  assert.strictEqual(v.all.find((x) => x.version === '0.2.11').tag, 'recommended');
});

test('version comparison', () => {
  assert.strictEqual(compareVersions('0.2.11', '0.2.9'), 1);
  assert.strictEqual(compareVersions('0.2.11', '0.3.1'), -1);
  assert.strictEqual(compareVersions('0.2.11', '0.2.11'), 0);
});

test('preset recommendation from GPU names', () => {
  const cases = {
    'NVIDIA GeForce RTX 4090': 'ultra',
    'NVIDIA GeForce RTX 3080': 'ultra',
    'NVIDIA GeForce RTX 3070': 'quality',
    'NVIDIA GeForce RTX 4060': 'quality',
    'NVIDIA GeForce RTX 3060': 'balanced',
    'NVIDIA GeForce RTX 2060': 'balanced',
    'NVIDIA GeForce GTX 1660 SUPER': 'balanced',
    'NVIDIA GeForce GTX 1050 Ti': 'performance',
    'AMD Radeon RX 7900 XTX': 'ultra',
    'AMD Radeon RX 6700 XT': 'quality',
    'AMD Radeon RX 6600': 'balanced',
    'AMD Radeon RX 580': 'balanced',
    'Intel(R) UHD Graphics 620': 'performance',
    'AMD Radeon(TM) Graphics': 'performance',
    '': 'balanced',
  };
  for (const [name, expected] of Object.entries(cases)) assert.strictEqual(graphics.recommendPreset(name), expected, name);
});

test('every preset defines the same CSP files and valid AC sections', () => {
  for (const id of graphics.PRESET_ORDER) {
    const files = graphics.presetFiles(id, { width: 2560, height: 1440, refresh: 144 });
    assert.ok(files['video.ini'].POST_PROCESS.ENABLED === 1 && files['video.ini'].POST_PROCESS.FXAA === 1, 'CSP needs PP + FXAA');
    assert.strictEqual(files['video.ini'].VIDEO.WIDTH, 2560);
    assert.strictEqual(files['video.ini'].VIDEO.REFRESH, 144);
    assert.strictEqual(files['extension/weather_fx.ini'].BASIC.ENABLED, 1);
    assert.ok(files['extension/extra_fx.ini']);
  }
  assert.strictEqual(graphics.presetFiles('performance')['extension/graphics_adjustments.ini'].FSR.ACTIVE, 1);
  assert.strictEqual(graphics.presetFiles('ultra')['extension/extra_fx.ini'].SSLR.TRACING_QUALITY3, 4);
});

test('applying a preset keeps player settings, backup + restore', () => {
  const docs = tmp();
  const cfg = path.join(docs, 'cfg');
  fs.mkdirSync(path.join(cfg, 'extension'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'video.ini'), '[VIDEO]\nFULLSCREEN=0\nFPS_CAP_MS=8.3\nAASAMPLES=8\n[CAMERA]\nMODE=TRIPLE\n');
  fs.writeFileSync(path.join(cfg, 'extension', 'general.ini'), '[CONTROL]\nRELEASE_DPAD=1\n');
  graphics.applyPreset(docs, 'quality', { display: { width: 1920, height: 1080, refresh: 165 } });
  const video = ini.parse(fs.readFileSync(path.join(cfg, 'video.ini'), 'utf8'));
  assert.strictEqual(video.CAMERA.MODE, 'TRIPLE', 'camera mode preserved');
  assert.strictEqual(video.VIDEO.FPS_CAP_MS, '8.3', 'fps cap preserved');
  assert.strictEqual(video.VIDEO.AASAMPLES, '4');
  assert.strictEqual(video.VIDEO.WIDTH, '1920');
  assert.strictEqual(video.POST_PROCESS.FILTER, 'default');
  const general = ini.parse(fs.readFileSync(path.join(cfg, 'extension', 'general.ini'), 'utf8'));
  assert.strictEqual(general.CONTROL.RELEASE_DPAD, '1', 'unrelated CSP setting preserved');
  assert.strictEqual(general.BASIC.ENABLED, '1');
  const extra = ini.parse(fs.readFileSync(path.join(cfg, 'extension', 'extra_fx.ini'), 'utf8'));
  assert.strictEqual(extra.ASSAO.ENABLED, '1');
  assert.ok(graphics.hasBackup(docs));

  // Second preset does not overwrite the original backup
  graphics.applyPreset(docs, 'performance', {});
  assert.strictEqual(ini.parse(fs.readFileSync(path.join(cfg, 'extension', 'extra_fx.ini'), 'utf8')).BASIC.ENABLED, '0');

  graphics.restoreBackup(docs);
  assert.strictEqual(fs.readFileSync(path.join(cfg, 'video.ini'), 'utf8'), '[VIDEO]\nFULLSCREEN=0\nFPS_CAP_MS=8.3\nAASAMPLES=8\n[CAMERA]\nMODE=TRIPLE\n');
  assert.ok(!fs.existsSync(path.join(cfg, 'extension', 'extra_fx.ini')), 'files created by LKS removed');
  assert.ok(!graphics.hasBackup(docs));
});

test('fresh install: video.ini created with default camera', () => {
  const docs = tmp();
  graphics.applyPreset(docs, 'balanced', { display: { width: 1920, height: 1080, refresh: 60 } });
  const video = ini.parse(fs.readFileSync(path.join(docs, 'cfg', 'video.ini'), 'utf8'));
  assert.strictEqual(video.CAMERA.MODE, 'DEFAULT');
});

function fakeCspZip(version) {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile();
    z.addBuffer(Buffer.from('MZ fake dll'), 'dwrite.dll');
    z.addBuffer(Buffer.from(`[VERSION]\nSHADERS_PATCH=${version}\nSHADERS_PATCH_BUILD=1\n`), 'extension/config/data_manifest.ini');
    z.addBuffer(Buffer.from('[BASIC]\nENABLED=1\n'), 'extension/config/general.ini');
    z.end();
    const chunks = [];
    z.outputStream.on('data', (c) => chunks.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

test('CSP install from the (mocked) official page, enable/disable', async (t) => {
  const page = fs.readFileSync(path.join(__dirname, 'fixtures', 'csp-page.html'), 'utf8');
  const zips = { '0.2.11': await fakeCspZip('0.2.11'), '0.3.1': await fakeCspZip('0.3.1') };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const get = u.searchParams.get('get');
    if (get && zips[get]) {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zips[get].length });
      return res.end(zips[get]);
    }
    if (get) return res.writeHead(200).end('Unknown version');
    res.end(page);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const ac = tmp();
  fs.writeFileSync(path.join(ac, 'acs.exe'), 'x');
  const m = new CspManager({ dataDir: tmp(), getAcRoot: () => ac, pageUrl: `http://127.0.0.1:${srv.address().port}/patch/` });
  assert.strictEqual(m.status().installed, false);
  const v = await m.available();
  assert.strictEqual(v.recommended, '0.2.11');
  const progress = [];
  m.on('progress', (p) => p && progress.push(p.phase));
  const st = await m.install(v.recommended);
  assert.strictEqual(st.version, '0.2.11');
  assert.ok(st.enabled);
  assert.ok(progress.includes('download'));
  assert.strictEqual(m.setEnabled(false).enabled, false);
  assert.ok(fs.existsSync(path.join(ac, 'dwrite.dll.lks-disabled')));
  assert.strictEqual(installedCsp(ac).installed, true);
  // Upgrading re-enables
  const up = await m.install('0.3.1');
  assert.strictEqual(up.version, '0.3.1');
  assert.ok(up.enabled);
  assert.ok(!fs.existsSync(path.join(ac, 'dwrite.dll.lks-disabled')));
  // Not a CSP archive -> refused
  await assert.rejects(() => m.install('9.9.9'), /CSP|ressemble|zip|end of central/i);
});

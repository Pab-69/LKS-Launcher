'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { GitHub } = require('../src/main/github');
const { Publisher } = require('../src/main/publisher');
const { ContentSync } = require('../src/main/sync');
const { hashFolder } = require('../src/main/hash');
const { getServerInfo, getServerCars } = require('../src/main/servers');
const { makeFakeAc, write } = require('./helpers/fakeAc');
const { startMockGithub } = require('./helpers/mockGithub');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lks-e2e-'));

test('publish -> sync -> modify -> republish -> update', async (t) => {
  const gh = await startMockGithub();
  t.after(() => gh.server.close());

  const adminAc = makeFakeAc(tmp(), { cars: { lks_e36: { name: 'BMW E36 LKS' }, lks_s14: { name: 'Silvia S14' } }, tracks: { lks_touge: { name: 'Touge' } } });
  const memberAc = makeFakeAc(tmp());
  const logs = [];
  const github = new GitHub({ token: 't', repo: 'o/r', apiBase: gh.base });
  const pub = new Publisher({ gh: github, tag: 'content', log: (l) => logs.push(l) });
  await pub.open();
  const report = await pub.publishItems(adminAc, [{ kind: 'car', id: 'lks_e36' }, { kind: 'car', id: 'lks_s14' }, { kind: 'track', id: 'lks_touge' }], { notes: 'v1' });
  assert.deepStrictEqual(report.map((r) => r.status), ['published', 'published', 'published']);
  assert.ok(gh.state.assets.some((a) => a.name === 'manifest.json'));

  // Member launcher
  const manifestUrl = `${gh.base}/dl/content/manifest.json`;
  const member = new ContentSync({ dataDir: tmp(), getAcRoot: () => memberAc, getManifestUrl: () => manifestUrl });
  await member.loadManifest();
  assert.strictEqual(member.manifestError, null);
  assert.strictEqual(member.summary().missing, 3);
  assert.strictEqual(member.manifest.cars[0].name, 'BMW E36 LKS');
  assert.ok(member.manifest.cars[0].preview.includes('preview.jpg'));
  assert.deepStrictEqual(member.manifest.tracks[0].layouts.map((l) => l.id), ['gp', 'short']);

  const done = new Promise((resolve) => member.once('done', resolve));
  member.enqueue();
  const results = await done;
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.strictEqual(member.summary().ok, 3);
  for (const [kind, id] of [['cars', 'lks_e36'], ['cars', 'lks_s14'], ['tracks', 'lks_touge']]) {
    const a = await hashFolder(path.join(adminAc, 'content', kind, id));
    const b = await hashFolder(path.join(memberAc, 'content', kind, id));
    assert.strictEqual(a.hash, b.hash, `${id} identical`);
  }

  // Re-publish without change: nothing uploaded
  const before = gh.state.assets.length;
  const again = await pub.publishItems(adminAc, [{ kind: 'car', id: 'lks_e36' }]);
  assert.strictEqual(again[0].status, 'unchanged');
  assert.strictEqual(gh.state.assets.length, before);

  // Admin edits the car (new physics + new skin + deleted file)
  write(path.join(adminAc, 'content', 'cars', 'lks_e36', 'data.acd'), 'new physics');
  write(path.join(adminAc, 'content', 'cars', 'lks_e36', 'skins', '02_red', 'preview.jpg'), 'red');
  fs.rmSync(path.join(adminAc, 'content', 'cars', 'lks_e36', 'skins', '01_white'), { recursive: true });
  const pub2 = new Publisher({ gh: github, tag: 'content' });
  await pub2.open();
  const r2 = await pub2.publishItems(adminAc, [{ kind: 'car', id: 'lks_e36' }], { notes: 'v2' });
  assert.strictEqual(r2[0].status, 'published');
  // Old archive garbage-collected
  assert.strictEqual(gh.state.assets.filter((a) => a.name.startsWith('car-lks_e36-') && a.name.endsWith('.zip')).length, 1);

  await member.loadManifest();
  const list = member.statusList();
  assert.strictEqual(list.find((i) => i.id === 'lks_e36').status, 'update');
  assert.strictEqual(list.find((i) => i.id === 'lks_s14').status, 'ok');
  const done2 = new Promise((resolve) => member.once('done', resolve));
  assert.strictEqual(member.enqueue(), 1);
  await done2;
  assert.strictEqual(member.summary().ok, 3);
  const memberCar = path.join(memberAc, 'content', 'cars', 'lks_e36');
  assert.strictEqual(fs.readFileSync(path.join(memberCar, 'data.acd'), 'utf8'), 'new physics');
  assert.ok(!fs.existsSync(path.join(memberCar, 'skins', '01_white')), 'deleted skin removed');
  assert.ok(fs.existsSync(path.join(memberCar, 'skins', '02_red', 'preview.jpg')));
  assert.ok(!fs.readdirSync(path.join(memberAc, 'content', 'cars')).some((n) => n.startsWith('.lks_')), 'no temp folders left');

  // Removing an item from the manifest
  await pub2.removeItems([{ kind: 'car', id: 'lks_s14' }]);
  await member.loadManifest();
  assert.strictEqual(member.manifest.cars.length, 1);
  assert.ok(!gh.state.assets.some((a) => a.name.startsWith('car-lks_s14')));

  // Meta (servers / news)
  await pub2.updateMeta({ servers: [{ name: 'LKS Drift', ip: '1.2.3.4', httpPort: 8081 }], news: [{ title: 'Yo', body: 'b', date: 'x' }] });
  await member.loadManifest();
  assert.strictEqual(member.manifest.servers[0].name, 'LKS Drift');
  assert.strictEqual(member.manifest.news[0].title, 'Yo');
});

test('first run: existing identical folder is recognised without download', async (t) => {
  const gh = await startMockGithub();
  t.after(() => gh.server.close());
  const adminAc = makeFakeAc(tmp(), { cars: { lks_e36: {} } });
  const pub = new Publisher({ gh: new GitHub({ token: 't', repo: 'o/r', apiBase: gh.base }), tag: 'content' });
  await pub.publishItems(adminAc, [{ kind: 'car', id: 'lks_e36' }]);
  // Member already has the same car (copied by hand)
  const memberAc = makeFakeAc(tmp());
  fs.cpSync(path.join(adminAc, 'content', 'cars', 'lks_e36'), path.join(memberAc, 'content', 'cars', 'lks_e36'), { recursive: true });
  const member = new ContentSync({ dataDir: tmp(), getAcRoot: () => memberAc, getManifestUrl: () => `${gh.base}/dl/content/manifest.json` });
  await member.loadManifest();
  assert.strictEqual(member.statusList()[0].status, 'unknown');
  const dl = gh.state.downloads;
  await member.verify(false);
  assert.strictEqual(member.statusList()[0].status, 'ok');
  assert.strictEqual(gh.state.downloads, dl, 'nothing downloaded');
});

test('download resumes from a partial file and rejects corrupt data', async (t) => {
  const gh = await startMockGithub();
  t.after(() => gh.server.close());
  const adminAc = makeFakeAc(tmp(), { cars: { big: { size: 2_000_000 } } });
  const pub = new Publisher({ gh: new GitHub({ token: 't', repo: 'o/r', apiBase: gh.base }), tag: 'content' });
  await pub.publishItems(adminAc, [{ kind: 'car', id: 'big' }]);
  const memberAc = makeFakeAc(tmp());
  const dataDir = tmp();
  const member = new ContentSync({ dataDir, getAcRoot: () => memberAc, getManifestUrl: () => `${gh.base}/dl/content/manifest.json` });
  await member.loadManifest();
  const item = member.manifest.cars[0];
  // Simulate an interrupted download: first 1000 bytes on disk
  const zipAsset = gh.state.assets.find((a) => a.name.endsWith('.zip'));
  fs.mkdirSync(path.join(dataDir, 'downloads'), { recursive: true });
  const part = path.join(dataDir, 'downloads', `car-big-${item.version.slice(0, 12)}.zip.part`);
  fs.writeFileSync(part, zipAsset.data.subarray(0, 1000));
  const done = new Promise((resolve) => member.once('done', resolve));
  member.enqueue();
  const res = await done;
  assert.ok(res[0].ok, JSON.stringify(res));
  assert.strictEqual(member.statusList()[0].status, 'ok');

  // Corrupted archive (wrong sha in manifest) is refused
  member.manifest.cars[0].sha256 = 'deadbeef';
  member.manifest.cars[0].version = 'other';
  const done2 = new Promise((resolve) => member.once('done', resolve));
  member.enqueue([{ kind: 'car', id: 'big' }]);
  const res2 = await done2;
  assert.strictEqual(res2[0].ok, false);
  assert.match(res2[0].error, /corrompu/);
  assert.ok(fs.existsSync(path.join(memberAc, 'content', 'cars', 'big', 'data.acd')), 'previous version kept');
});

test('AC server INFO / JSON queries', async (t) => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/INFO') return res.end(JSON.stringify({ name: 'LKS Drift', clients: 3, maxclients: 20, track: 'lks_touge-gp', cars: ['lks_e36'], port: 9600, tport: 9600, cport: 8081, pass: true, session: 1 }));
    if (req.url === '/JSON|7656') return res.end('﻿' + JSON.stringify({ Cars: [{ Model: 'lks_e36', Skin: '00_black', IsConnected: true, DriverName: 'Bob' }, { Model: 'lks_e36', Skin: '01_white', IsConnected: false }] }));
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const server = { ip: '127.0.0.1', httpPort: srv.address().port, name: 'x' };
  const info = await getServerInfo(server);
  assert.strictEqual(info.online, true);
  assert.strictEqual(info.tcpPort, 9600);
  assert.strictEqual(info.hasPassword, true);
  const cars = await getServerCars(server, '7656');
  assert.strictEqual(cars.length, 2);
  assert.strictEqual(cars[0].driver, 'Bob');
  assert.strictEqual(cars[1].connected, false);
  const off = await getServerInfo({ ip: '127.0.0.1', httpPort: 1, name: 'off' });
  assert.strictEqual(off.online, false);
});

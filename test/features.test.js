'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { GitHub } = require('../src/main/github');
const { Publisher } = require('../src/main/publisher');
const { SetupSync, localSetupCars, installedName } = require('../src/main/setups');
const { DiscordPresence, encode } = require('../src/main/discord');
const { startMockGithub } = require('./helpers/mockGithub');
const { write } = require('./helpers/fakeAc');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lks-feat-'));

test('publication history records who did what', async (t) => {
  const gh = await startMockGithub();
  t.after(() => gh.server.close());
  const pub = new Publisher({ gh: new GitHub({ token: 't', repo: 'o/r', apiBase: gh.base }), tag: 'content' });
  await pub.open();
  await pub.updateMeta({ events: [{ id: 'e1', title: 'Soirée drift', date: '2026-11-07T20:00:00Z' }], soloPresets: [] });
  assert.strictEqual(pub.manifest.history.length, 2);
  assert.strictEqual(pub.manifest.history[0].by, 'pab');
  assert.match(pub.manifest.history.map((h) => h.action).join('|'), /Calendrier/);
  assert.strictEqual(pub.manifest.events[0].title, 'Soirée drift');
});

test('setups: admin publishes, members install next to their own, updates and removals', async (t) => {
  const gh = await startMockGithub();
  t.after(() => gh.server.close());
  const adminDocs = tmp();
  write(path.join(adminDocs, 'setups', 'lks_bmw_m2', 'haruna', 'drift.ini'), '[FRONT]\nVALUE=1\n');
  write(path.join(adminDocs, 'setups', 'lks_bmw_m2', 'generic', 'grip.ini'), '[FRONT]\nVALUE=2\n');
  write(path.join(adminDocs, 'setups', 'lks_bmw_m2', 'generic', 'notes.txt'), 'ignored');
  write(path.join(adminDocs, 'setups', 'lks_bmw_m2', 'generic', 'LKS_old.ini'), 'already installed from the group, not republished');
  assert.deepStrictEqual(localSetupCars(adminDocs), [{ car: 'lks_bmw_m2', count: 2 }]);

  const pub = new Publisher({ gh: new GitHub({ token: 't', repo: 'o/r', apiBase: gh.base }), tag: 'content' });
  const r = await pub.publishSetups(adminDocs, ['lks_bmw_m2'], { lks_bmw_m2: 'BMW M2' });
  assert.strictEqual(r[0].status, 'published');
  assert.deepStrictEqual(pub.manifest.setups[0].files.sort(), ['generic/grip.ini', 'haruna/drift.ini']);

  // Member with a personal setup of the same name
  const memberDocs = tmp();
  write(path.join(memberDocs, 'setups', 'lks_bmw_m2', 'haruna', 'drift.ini'), 'MINE');
  const mgr = new SetupSync({ dataDir: tmp(), getDocsDir: () => memberDocs });
  const res = await mgr.sync(pub.manifest.setups);
  assert.strictEqual(res.installed, 2);
  assert.strictEqual(fs.readFileSync(path.join(memberDocs, 'setups', 'lks_bmw_m2', 'haruna', 'drift.ini'), 'utf8'), 'MINE', 'personal setup untouched');
  assert.match(fs.readFileSync(path.join(memberDocs, 'setups', 'lks_bmw_m2', 'haruna', 'LKS_drift.ini'), 'utf8'), /VALUE=1/);

  // Admin removes one setup and republishes -> member loses only that LKS file
  fs.rmSync(path.join(adminDocs, 'setups', 'lks_bmw_m2', 'generic', 'grip.ini'));
  await pub.publishSetups(adminDocs, ['lks_bmw_m2']);
  await mgr.sync(pub.manifest.setups);
  assert.ok(!fs.existsSync(path.join(memberDocs, 'setups', 'lks_bmw_m2', 'generic', 'LKS_grip.ini')));
  assert.ok(fs.existsSync(path.join(memberDocs, 'setups', 'lks_bmw_m2', 'haruna', 'LKS_drift.ini')));

  // Setups withdrawn entirely
  await pub.removeSetups(['lks_bmw_m2']);
  const r3 = await mgr.sync(pub.manifest.setups);
  assert.strictEqual(r3.removed, 1);
  assert.strictEqual(fs.readFileSync(path.join(memberDocs, 'setups', 'lks_bmw_m2', 'haruna', 'drift.ini'), 'utf8'), 'MINE');
  assert.ok(!gh.state.assets.some((a) => a.name.startsWith('setups-')), 'archive garbage-collected');
  assert.strictEqual(installedName('a/LKS drift.ini'), 'a/LKS drift.ini');
});

test('Discord Rich Presence: handshake and activity frames', async (t) => {
  if (process.platform === 'win32') return; // named pipes: covered by the unix socket variant
  const dir = tmp();
  const frames = [];
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;
        const msg = JSON.parse(buf.subarray(8, 8 + len).toString());
        buf = buf.subarray(8 + len);
        frames.push({ op, msg });
        if (op === 0) sock.write(encode(1, { cmd: 'DISPATCH', evt: 'READY', data: { user: { username: 'pab' } } }));
      }
    });
  });
  await new Promise((r) => server.listen(path.join(dir, 'discord-ipc-0'), r));
  t.after(() => server.close());

  const p = new DiscordPresence({ ipcPathFor: (i) => path.join(dir, `discord-ipc-${i}`) });
  const ready = new Promise((r) => p.once('ready', r));
  p.configure({ clientId: '123456789012345678', enabled: true });
  p.setActivity({ details: 'Solo — Entraînement', state: 'BMW M2 @ Haruna', startedAt: 1700000000000, largeImage: 'https://example.com/logo.png', buttons: [{ label: 'Rejoindre le Syndicate', url: 'https://discord.gg/x' }, { label: 'bad', url: 'http://insecure' }] });
  assert.strictEqual((await ready).username, 'pab');
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(frames[0].op, 0);
  assert.strictEqual(frames[0].msg.client_id, '123456789012345678');
  const act = frames.find((f) => f.msg.cmd === 'SET_ACTIVITY').msg.args.activity;
  assert.strictEqual(act.details, 'Solo — Entraînement');
  assert.strictEqual(act.timestamps.start, 1700000000);
  assert.strictEqual(act.buttons.length, 1, 'non-https button dropped');
  p.configure({ clientId: null, enabled: true });
  assert.strictEqual(p.connected, false);
});

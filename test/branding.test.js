'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { GitHub } = require('../src/main/github');
const { Publisher } = require('../src/main/publisher');
const { BrandingManager, readBrandingFolder } = require('../src/main/branding');
const { startMockGithub } = require('./helpers/mockGithub');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lks-brand-'));

function brandFolder() {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'logo.png'), crypto.randomBytes(3000));
  fs.writeFileSync(path.join(dir, 'logo-wide.png'), crypto.randomBytes(2000));
  fs.writeFileSync(path.join(dir, 'car.jpg'), crypto.randomBytes(4000));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  fs.writeFileSync(path.join(dir, 'showcase.json'), JSON.stringify([{ image: 'car.jpg', title: 'BMW M2', subtitle: '#17' }]));
  return dir;
}

test('branding folder validation', () => {
  const dir = brandFolder();
  const r = readBrandingFolder(dir);
  assert.deepStrictEqual(r.files.sort(), ['car.jpg', 'logo-wide.png', 'logo.png']);
  fs.writeFileSync(path.join(dir, 'showcase.json'), JSON.stringify([{ image: 'missing.jpg' }]));
  assert.throws(() => readBrandingFolder(dir), /introuvable/);
  const empty = tmp();
  assert.throws(() => readBrandingFolder(empty), /logo\.png/);
});

test('publish branding -> launcher downloads it, updates and cleans up', async (t) => {
  const gh = await startMockGithub();
  t.after(() => gh.server.close());
  const pub = new Publisher({ gh: new GitHub({ token: 't', repo: 'o/r', apiBase: gh.base }), tag: 'content' });
  const dir = brandFolder();
  const r = await pub.publishBranding(dir);
  assert.strictEqual(r.files, 3);
  assert.ok(gh.state.assets.some((a) => a.name.startsWith('branding-') && a.name.endsWith('logo.png')));

  const mgr = new BrandingManager({ dataDir: tmp() });
  assert.strictEqual(await mgr.sync(pub.manifest.branding), true);
  assert.ok(mgr.file('logo.png'));
  assert.strictEqual(mgr.status().showcase[0].title, 'BMW M2');
  assert.strictEqual(fs.readFileSync(mgr.file('car.jpg')).length, 4000);
  // same version -> nothing to do
  assert.strictEqual(await mgr.sync(pub.manifest.branding), false);
  assert.strictEqual(mgr.file('../secret.png'), null);

  // Admin replaces the photo and removes the wide logo
  fs.writeFileSync(path.join(dir, 'car.jpg'), crypto.randomBytes(5000));
  fs.rmSync(path.join(dir, 'logo-wide.png'));
  const pub2 = new Publisher({ gh: new GitHub({ token: 't', repo: 'o/r', apiBase: gh.base }), tag: 'content' });
  await pub2.open();
  await pub2.publishBranding(dir);
  assert.strictEqual(gh.state.assets.filter((a) => a.name.startsWith('branding-')).length, 2, 'old assets garbage-collected');
  assert.strictEqual(await mgr.sync(pub2.manifest.branding), true);
  assert.strictEqual(fs.readFileSync(mgr.file('car.jpg')).length, 5000);
  assert.strictEqual(mgr.file('logo-wide.png'), null, 'removed file deleted locally');

  // Tampered file is rejected, previous copy kept
  const bad = JSON.parse(JSON.stringify(pub2.manifest.branding));
  bad.version = 'other';
  bad.files.find((f) => f.name === 'car.jpg').sha256 = 'deadbeef';
  const failures = [];
  mgr.on('failed', (e) => failures.push(e.name));
  await mgr.sync(bad);
  assert.deepStrictEqual(failures, ['car.jpg']);
  assert.strictEqual(fs.readFileSync(mgr.file('car.jpg')).length, 5000);
});

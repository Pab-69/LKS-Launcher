'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { update } = require('../tools/update-latest');

test('latest.yml is regenerated for a (re-signed) installer', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'lks-rel-'));
  const exe = path.join(dist, 'LKS-Launcher-Setup-9.9.9.exe');
  fs.writeFileSync(exe, crypto.randomBytes(500000));
  const r = update(dist, '9.9.9');
  const yml = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
  const sha = crypto.createHash('sha512').update(fs.readFileSync(exe)).digest('base64');
  assert.match(yml, /^version: 9\.9\.9$/m);
  assert.match(yml, /^path: LKS-Launcher-Setup-9\.9\.9\.exe$/m);
  assert.ok(yml.includes(`sha512: ${sha}`));
  assert.match(yml, /size: 500000/);
  assert.strictEqual(r.blockmap, true);
  assert.ok(fs.existsSync(`${exe}.blockmap`));
  assert.throws(() => update(dist, '0.0.1'), /introuvable/);
});

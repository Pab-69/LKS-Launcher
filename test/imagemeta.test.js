'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripImage, kindOf } = require('../src/main/imagemeta');
const { scrub } = require('../src/main/crashlog');

test('gallery photos: hidden data removed (EXIF, GPS, camera, comments, XMP), picture kept', () => {
  for (const ext of ['jpg', 'png', 'webp']) {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', `exif.${ext}`));
    assert.ok(raw.includes('SECRET'), ext);
    const clean = stripImage(raw, ext);
    assert.strictEqual(kindOf(clean), ext);
    assert.ok(!clean.includes('SECRET'), `${ext}: nothing left`);
    assert.ok(!clean.includes('Exif\0'), `${ext}: no EXIF`);
    assert.ok(clean.length < raw.length);
  }
  assert.throws(() => stripImage(Buffer.from('PK\x03\x04zip'), 'jpg'), /JPEG, PNG ou WebP/);
  assert.throws(() => stripImage(fs.readFileSync(path.join(__dirname, 'fixtures', 'exif.png')), 'jpg'), /JPEG, PNG ou WebP/);
});

test('crash report for the admins: no Steam ID, account name, IP or e-mail', () => {
  const t = scrub('SteamID 76561198012345678\nC:\\Users\\Jean Dupont\\Documents\\Assetto Corsa\\logs\nserver 51.68.10.2:9600 mail jean@exemple.fr');
  assert.ok(!/7656119|Jean|51\.68|jean@/.test(t), t);
  assert.match(t, /C:\\Users\\\[nom\]\\Documents/);
});

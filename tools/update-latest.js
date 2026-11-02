#!/usr/bin/env node
'use strict';

/**
 * Regenerates dist/latest.yml and the .blockmap of the installer.
 *
 * Needed when the installer is signed AFTER electron-builder ran (SignPath):
 * signing changes the file, so its sha512/size/blockmap must be recomputed,
 * otherwise auto-update would reject the download.
 *
 *   node tools/update-latest.js [distDir]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

function blockmap(file) {
  let appBuilder;
  try {
    appBuilder = require('app-builder-bin').appBuilderPath;
  } catch {
    return null;
  }
  const out = execFileSync(appBuilder, ['blockmap', '--input', file, '--output', `${file}.blockmap`], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

function latestYml({ version, fileName, sha, size, releaseDate }) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${fileName}`,
    `    sha512: ${sha}`,
    `    size: ${size}`,
    `path: ${fileName}`,
    `sha512: ${sha}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');
}

function update(distDir, version) {
  const fileName = `LKS-Launcher-Setup-${version}.exe`;
  const file = path.join(distDir, fileName);
  if (!fs.existsSync(file)) throw new Error(`Installeur introuvable : ${file}`);
  const bm = blockmap(file);
  const sha = sha512(file);
  if (bm && bm.sha512 !== sha) throw new Error('Empreinte incohérente entre blockmap et sha512');
  const size = fs.statSync(file).size;
  const yml = latestYml({ version, fileName, sha, size, releaseDate: new Date().toISOString() });
  fs.writeFileSync(path.join(distDir, 'latest.yml'), yml);
  return { file, sha, size, blockmap: Boolean(bm) };
}

if (require.main === module) {
  const distDir = process.argv[2] || 'dist';
  const { version } = require('../package.json');
  const r = update(distDir, version);
  console.log(`latest.yml mis à jour : ${path.basename(r.file)} (${r.size} octets)${r.blockmap ? ' + blockmap' : ''}`);
}

module.exports = { update, latestYml, sha512 };

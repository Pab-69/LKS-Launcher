'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IGNORED = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

/** Recursively list files of a folder, as sorted POSIX relative paths. */
async function listFiles(root) {
  const files = [];
  async function walk(dir, rel) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED.has(entry.name.toLowerCase())) continue;
      if (entry.name.startsWith('.lks_')) continue;
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(abs, relPath);
      else if (entry.isFile()) files.push(relPath);
    }
  }
  await walk(root, '');
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return files;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let size = 0;
    fs.createReadStream(file)
      .on('data', (chunk) => {
        size += chunk.length;
        hash.update(chunk);
      })
      .on('error', reject)
      .on('end', () => resolve({ hash: hash.digest('hex'), size }));
  });
}

/**
 * Deterministic content hash of a folder: identical files => identical hash,
 * whatever the machine. This hash is the "version" of a car/track.
 */
async function hashFolder(root, onProgress) {
  const files = await listFiles(root);
  const total = crypto.createHash('sha256');
  let size = 0;
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const info = await hashFile(path.join(root, ...rel.split('/')));
    size += info.size;
    total.update(`${rel}\0${info.size}\0${info.hash}\n`);
    if (onProgress) onProgress(i + 1, files.length);
  }
  return { hash: total.digest('hex'), files: files.length, size };
}

module.exports = { listFiles, hashFile, hashFolder };

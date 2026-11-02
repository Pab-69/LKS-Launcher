'use strict';

const fs = require('fs');
const path = require('path');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { listFiles } = require('./hash');

// Already-compressed formats: storing them is faster and barely bigger.
const STORE_EXT = new Set(['.jpg', '.jpeg', '.png', '.zip', '.7z', '.ogg', '.bank', '.acd']);

/** Zip the content of `srcDir` (without the folder itself) into `outFile`. */
async function zipFolder(srcDir, outFile, onProgress) {
  const files = await listFiles(srcDir);
  const zip = new yazl.ZipFile();
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    zip.addFile(path.join(srcDir, ...rel.split('/')), rel, { compress: !STORE_EXT.has(ext) });
  }
  zip.end();
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outFile);
    let written = 0;
    zip.outputStream.on('data', (chunk) => {
      written += chunk.length;
      if (onProgress) onProgress(written);
    });
    zip.outputStream.on('error', reject);
    out.on('error', reject);
    out.on('close', resolve);
    zip.outputStream.pipe(out);
  });
  return { files: files.length };
}

function safeJoin(root, rel) {
  const normalized = rel.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Chemin interdit dans l'archive : ${rel}`);
  }
  const target = path.resolve(root, ...normalized.split('/'));
  const base = path.resolve(root) + path.sep;
  if (!target.startsWith(base)) throw new Error(`Chemin interdit dans l'archive : ${rel}`);
  return target;
}

/** Extract `zipFile` into `destDir`. onProgress(bytesDone, bytesTotal). */
function extractZip(zipFile, destDir, onProgress, signal) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      let total = 0;
      let done = 0;
      let failed = false;
      const fail = (e) => {
        if (failed) return;
        failed = true;
        zip.close();
        reject(e);
      };
      // Uncompressed total for progress (entries are read from central directory lazily,
      // so we use the zip's declared entry count + per-entry sizes as we go).
      total = 0;
      zip.on('entry', (entry) => {
        if (signal && signal.aborted) return fail(new Error('Annulé'));
        let target;
        try {
          target = safeJoin(destDir, entry.fileName);
        } catch (e) {
          return fail(e);
        }
        if (/\/$/.test(entry.fileName)) {
          fs.promises.mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail);
          return;
        }
        total += entry.uncompressedSize;
        fs.promises
          .mkdir(path.dirname(target), { recursive: true })
          .then(() => {
            zip.openReadStream(entry, (e, stream) => {
              if (e) return fail(e);
              const out = fs.createWriteStream(target);
              stream.on('data', (chunk) => {
                done += chunk.length;
                if (onProgress) onProgress(done, Math.max(total, done), zip.entryCount);
              });
              stream.on('error', fail);
              out.on('error', fail);
              out.on('close', () => zip.readEntry());
              stream.pipe(out);
            });
          }, fail);
      });
      zip.on('end', () => {
        if (!failed) resolve({ bytes: done, entries: zip.entryCount });
      });
      zip.on('error', fail);
      zip.readEntry();
    });
  });
}

module.exports = { zipFolder, extractZip, safeJoin };

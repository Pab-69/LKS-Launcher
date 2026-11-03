'use strict';

/**
 * Photos sent to the group's gallery: the hidden data of the file is removed
 * (EXIF with the GPS position, the camera, the date, XMP, comments) and only
 * the picture is kept. Used by the launcher before sending and by the group's
 * server (server/storage) on reception. No dependency.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function kindOf(buf) {
  if (buf.length > 3 && buf.subarray(0, 3).equals(JPEG)) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG)) return 'png';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** JPEG: drop the APP1..APP15 segments (EXIF, XMP…) and comments; JFIF, Adobe and the colour profile stay. */
function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error('JPEG invalide');
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // padding
      continue;
    }
    if (marker === 0xda) {
      out.push(buf.subarray(i)); // start of scan: the picture itself, up to the end
      return Buffer.concat(out);
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw new Error('JPEG invalide');
    const icc = marker === 0xe2 && buf.toString('latin1', i + 4, i + 16) === 'ICC_PROFILE\0';
    const keep = icc || !((marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe);
    if (keep) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw new Error('JPEG invalide');
}

/** PNG: drop the text and EXIF chunks (tEXt, zTXt, iTXt, eXIf, tIME). */
function stripPng(buf) {
  const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  const out = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new Error('PNG invalide');
    if (!drop.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  throw new Error('PNG invalide');
}

/** WebP: drop the EXIF and XMP chunks (and their flags in VP8X). */
function stripWebp(buf) {
  const chunks = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > buf.length) throw new Error('WebP invalide');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const c = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
      if (type === 'VP8X' && c.length > 8) c[8] &= ~(0x08 | 0x04); // EXIF and XMP flags
      chunks.push(c);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** Picture without its hidden data; throws if the file is not the announced kind of picture. */
function stripImage(buf, ext) {
  const kind = kindOf(buf);
  if (!kind || (ext && kind !== ext)) throw new Error('Image JPEG, PNG ou WebP seulement');
  if (kind === 'jpg') return stripJpeg(buf);
  if (kind === 'png') return stripPng(buf);
  return stripWebp(buf);
}

module.exports = { stripImage, kindOf };

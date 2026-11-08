/** Petit dessin en PNG sans dépendance (traits épais, disques, chiffres) pour les images de parcours. */
const zlib = require('node:zlib');

class Canvas {
  constructor(w, h, bg = [10, 8, 10]) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }
  set(x, y, c, a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a);
  }
  disc(cx, cy, r, c, a = 1) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) this.set(x, y, c, a);
  }
  ring(cx, cy, r, c, width = 2) {
    for (let a = 0; a < Math.PI * 2; a += 0.5 / Math.max(r, 1)) this.disc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, width / 2, c);
  }
  line(x0, y0, x1, y1, c, width = 2, a = 1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.5, width / 3)));
    for (let i = 0; i <= n; i++) this.disc(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, width / 2, c, a);
  }
  poly(pts, c, width = 2, a = 1) {
    for (let i = 1; i < pts.length; i++) this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c, width, a);
  }
  /** Chiffres et quelques lettres en police 3×5, agrandis `size` fois. */
  text(x, y, str, c, size = 3) {
    const F = {
      0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
      5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
      Z: '111001010100111', S: '111100111001111', D: '110101101101110', A: '010101111101101', R: '110101110101101', ' ': '000000000000000',
    };
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = F[ch];
      if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.set(cx + (i % 3) * size + dx, y + Math.floor(i / 3) * size + dy, c);
      cx += 4 * size;
    }
  }
  png() {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      this.px.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) : crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  }
}

let table = null;
function crc32(buf) {
  if (!table) table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

module.exports = { Canvas };

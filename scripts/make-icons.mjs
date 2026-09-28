// Generate the PWA icons as PNGs with no image dependencies:
// rasterise a few rounded rectangles into an RGBA buffer, then deflate it into
// a minimal single-IDAT PNG.
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const BLUE = [0x3b, 0x6e, 0xf5];

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // rows must be prefixed with a filter byte
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function render(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const inset = maskable ? size * 0.14 : 0;         // safe zone for maskable icons
  const plate = size - inset * 2;
  const radius = maskable ? plate / 2 : size * 0.22; // full circle when maskable

  const put = (x, y, [r, g, b], a) => {
    const i = (y * size + x) * 4;
    const src = a / 255;
    // composite over whatever is already there
    const dstA = buf[i + 3] / 255;
    const outA = src + dstA * (1 - src);
    if (outA === 0) return;
    for (let c = 0; c < 3; c++) {
      buf[i + c] = Math.round((([r, g, b][c] * src) + buf[i + c] * dstA * (1 - src)) / outA);
    }
    buf[i + 3] = Math.round(outA * 255);
  };

  // coverage of a rounded rect at a pixel centre, supersampled 3x3
  const cover = (px, py, x0, y0, w, h, r) => {
    let hits = 0;
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        const x = px + (sx + 0.5) / 3;
        const y = py + (sy + 0.5) / 3;
        const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
        const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
        const dx = x - cx, dy = y - cy;
        if (x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && dx * dx + dy * dy <= r * r + 1e-9) hits++;
      }
    }
    return hits / 9;
  };

  const rect = (x0, y0, w, h, color, alpha, r) => {
    const r2 = Math.min(r, w / 2, h / 2);
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y0 + h)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x0 + w)); x++) {
        const c = cover(x, y, x0, y0, w, h, r2);
        if (c > 0) put(x, y, color, Math.round(255 * alpha * c));
      }
    }
  };

  rect(inset, inset, plate, plate, BLUE, 1, radius);

  // two columns of bars: a playlist and its counterpart, differing in emphasis
  const u = plate / 64;
  const barW = 16 * u, barH = 6 * u, barR = 3 * u;
  const left = inset + 14 * u, right = inset + 36 * u;
  const ys = [16, 29, 42].map((v) => inset + v * u);
  const opacities = [[1, 0.75, 0.5], [0.5, 1, 0.75]];

  ys.forEach((y, row) => {
    rect(left, y, barW, barH, [255, 255, 255], opacities[0][row], barR);
    rect(right, y, barW, barH, [255, 255, 255], opacities[1][row], barR);
  });

  return png(size, size, buf);
}

const out = "public";
fs.mkdirSync(out, { recursive: true });
const files = [
  ["icon-192.png", render(192)],
  ["icon-512.png", render(512)],
  ["icon-512-maskable.png", render(512, { maskable: true })],
];
for (const [name, data] of files) {
  fs.writeFileSync(path.join(out, name), data);
  console.log(`${name}  ${(data.length / 1024).toFixed(1)} KB`);
}

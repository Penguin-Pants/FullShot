/**
 * Generates the FullShot toolbar/store icons as PNGs with no external image deps.
 * A gradient rounded square with a white "capture frame" motif, supersampled 4x for smooth edges.
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor

// Brand gradient (teal -> sky), matching the UI accent colors.
const C1 = [20, 184, 166];
const C2 = [14, 165, 233];

function roundedRectContains(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  if (px >= x && px <= x + w && py >= y + r && py <= y + h - r) return true;
  if (py >= y && py <= y + h && px >= x + r && px <= x + w - r) return true;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Return RGBA (0..255) for a point in [0,size) space. */
function sampleColor(px, py, size) {
  const appR = size * 0.22;
  if (!roundedRectContains(px, py, 0, 0, size, size, appR)) return [0, 0, 0, 0];

  // Diagonal gradient fill.
  const t = (px + py) / (2 * size);
  const base = [
    Math.round(C1[0] + (C2[0] - C1[0]) * t),
    Math.round(C1[1] + (C2[1] - C1[1]) * t),
    Math.round(C1[2] + (C2[2] - C1[2]) * t),
    255,
  ];

  // White capture frame (an outlined rounded rect band).
  const inset = size * 0.26;
  const fw = size - inset * 2;
  const band = Math.max(size * 0.075, 1.4);
  const outer = roundedRectContains(px, py, inset, inset, fw, fw, size * 0.09);
  const inner = roundedRectContains(
    px,
    py,
    inset + band,
    inset + band,
    fw - band * 2,
    fw - band * 2,
    size * 0.06,
  );
  if (outer && !inner) return [255, 255, 255, 255];
  return base;
}

function renderSize(size) {
  const big = size * SS;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ((x * SS + sx + 0.5) / big) * size;
          const py = ((y * SS + sy + 0.5) / big) * size;
          const [cr, cg, cb, ca] = sampleColor(px, py, size);
          // Premultiply for correct edge blending.
          r += (cr * ca) / 255;
          g += (cg * ca) / 255;
          b += (cb * ca) / 255;
          a += ca;
        }
      }
      const n = SS * SS;
      const outA = a / n;
      const idx = (y * size + x) * 4;
      if (outA <= 0) {
        rgba[idx] = rgba[idx + 1] = rgba[idx + 2] = rgba[idx + 3] = 0;
      } else {
        rgba[idx] = Math.round((r / n) * (255 / outA));
        rgba[idx + 1] = Math.round((g / n) * (255 / outA));
        rgba[idx + 2] = Math.round((b / n) * (255 / outA));
        rgba[idx + 3] = Math.round(outA);
      }
    }
  }
  return rgba;
}

/* ---- Minimal PNG encoder (8-bit RGBA) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // filter each scanline with filter byte 0 (none)
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(renderSize(size), size);
  writeFileSync(resolve(OUT_DIR, `icon${size}.png`), png);
  console.log(`wrote icons/icon${size}.png (${png.length} bytes)`);
}

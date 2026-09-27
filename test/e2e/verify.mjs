/**
 * Output checks shared by the E2E harnesses: decode the PNG a capture produced and verify it
 * against the long fixture page (test/fixtures/long-page.html), and read a PDF's structure.
 */
import zlib from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, color ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
  }
  return { width, height, at: (x, y) => { const i = y * stride + x * bpp; return [px[i], px[i + 1], px[i + 2], bpp === 4 ? px[i + 3] : 255]; } };
}

/** Height of the long fixture: 40px in-flow sticky nav + 100px padding + 12 × 700px sections. */
export const LONG_H = 8540;
export const near = (p, rgb, tol = 8) => Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol && p[3] > 200;

/**
 * Check a capture of the long fixture: size, every section present, fixed header and sticky nav
 * captured once, and no scrollbar painted into the tiles. Returns a list of problems.
 */
export function checkLongPage(png, dpr, cssWidth) {
  const problems = [];
  const expH = Math.round(LONG_H * dpr);
  const expW = Math.round(cssWidth * dpr);
  if (Math.abs(png.height - expH) > 1) problems.push(`height ${png.height} != ${expH}`);
  if (Math.abs(png.width - expW) > 1) problems.push(`width ${png.width} != ${expW}`);
  // Header/nav scan column: inside the full-width header and the 900px body, clear of the
  // centred section-number glyphs (which are nearly the header colour).
  const x = Math.round(700 * dpr);
  const missing = [];
  for (let i = 1; i <= 12; i++) {
    const y = Math.round((140 + (i - 1) * 700 + 350) * dpr);
    if (y >= png.height) { missing.push(i); continue; }
    const want = i % 2 ? [224, 242, 254] : [252, 231, 243];
    // The section number glyph is centred; sample left of it.
    const p = png.at(Math.round(200 * dpr), y);
    if (!near(p, want)) missing.push(`${i}:${p.slice(0, 3).join(',')}`);
  }
  if (missing.length) problems.push(`sections wrong/missing: ${missing.join(' ')}`);
  let dark = 0;
  let blue = 0;
  for (let y = 0; y < png.height; y++) {
    const p = png.at(x, y);
    if (near(p, [17, 24, 39], 12)) dark++;
    if (near(p, [37, 99, 235], 12)) blue++;
  }
  // Right of the 900px body the page is plain white, so anything painted in the last few columns
  // below the header is a scrollbar captured into the tiles.
  if (png.width >= Math.round(930 * dpr)) {
    let edge = 0;
    for (let y = Math.round(60 * dpr); y < png.height; y++) {
      for (let ex = png.width - Math.round(12 * dpr); ex < png.width; ex++) {
        if (!near(png.at(ex, y), [255, 255, 255], 6)) { edge++; break; }
      }
    }
    if (edge) problems.push(`scrollbar painted into the capture (${edge} rows)`);
  }
  if (dark > 70 * dpr) problems.push(`fixed header repeated (${dark} rows)`);
  if (dark < 50 * dpr) problems.push(`fixed header missing (${dark} rows)`);
  if (blue > 50 * dpr) problems.push(`sticky nav repeated (${blue} rows)`);
  return problems;
}

export function checkPdf(buf) {
  const text = buf.toString('latin1');
  if (!text.startsWith('%PDF')) return { problems: ['not a PDF'] };
  const pages = (text.match(/\/Type \/Page\b(?!s)/g) || []).length;
  const imgs = [...text.matchAll(/\/Width (\d+)\s*\n?\/Height (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const totalH = imgs.reduce((s, [, h]) => s + h, 0);
  return { pages, width: imgs[0]?.[0], totalH, problems: [] };
}

const samePx = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** Pixels [x, y] where two decoded PNGs of the same size differ in any channel. */
export function changedPixels(a, b) {
  const out = [];
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) if (!samePx(a.at(x, y), b.at(x, y))) out.push([x, y]);
  }
  return out;
}

/**
 * How well the red annotations in `part` line up with those in the same-sized area of `whole` at
 * (ox, oy): intersection over union of their red pixels (the editor's default colour is red).
 */
export function redOverlap(part, whole, ox, oy) {
  const red = (p) => p[0] - Math.max(p[1], p[2]) > 40;
  let both = 0;
  let either = 0;
  let inPart = 0;
  for (let y = 0; y < part.height; y++) {
    for (let x = 0; x < part.width; x++) {
      const a = red(part.at(x, y));
      const wx = ox + x;
      const wy = oy + y;
      const b = wx >= 0 && wy >= 0 && wx < whole.width && wy < whole.height && red(whole.at(wx, wy));
      if (a) inPart++;
      if (a && b) both++;
      if (a || b) either++;
    }
  }
  return { iou: either ? both / either : 0, red: inPart };
}

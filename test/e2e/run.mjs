/**
 * End-to-end verification for FullShot.
 *
 * Loads the (test-flagged) extension in the pre-installed Chromium under xvfb, drives a real
 * full-page capture on a long fixture page, then exercises the editor + PNG/PDF export — asserting
 * on real output (stitched height, fixed-header-appears-once, PNG/PDF file signatures).
 *
 * Run:  xvfb-run -a node test/e2e/run.mjs
 * Requires a test build:  FULLSHOT_TEST=1 npx vite build --outDir dist-test
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const EXT = join(ROOT, 'dist-test');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = join(__dirname, 'out');
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(EXT)) {
  console.error(`Missing ${EXT}. Build it first: FULLSHOT_TEST=1 npx vite build --outDir dist-test`);
  process.exit(2);
}

// --- static server for the fixture ---
const fixtures = join(ROOT, 'test/fixtures');
const server = http.createServer((req, res) => {
  const p = join(fixtures, decodeURIComponent(req.url.split('?')[0]));
  try {
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const userDataDir = join(OUT, 'profile');
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath: CHROME,
  viewport: null,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--window-size=1200,840',
  ],
});

let exitCode = 1;
try {
  // --- service worker + extension id ---
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  check('service worker registered', !!extId, extId);

  for (let i = 0; i < 40 && !(await sw.evaluate(() => !!self.__fullshotTest).catch(() => false)); i++) {
    await sleep(250);
  }
  check('test hook present on SW', await sw.evaluate(() => !!self.__fullshotTest));

  // --- open the long page and make it the active tab ---
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${base}/long-page.html`, { waitUntil: 'load' });
  await page.bringToFront();
  await sleep(400);

  // --- trigger a real capture; wait for the editor tab to open ---
  const editorPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/src/editor/'),
    timeout: 90000,
  });
  await sw.evaluate(async () => {
    await self.__fullshotTest('edit');
  });
  const editor = await editorPromise;
  await editor.waitForLoadState('domcontentloaded');
  await editor.waitForFunction(() => window.__fullshot && window.__fullshot.dims().h > 0, { timeout: 30000 });

  const dims = await editor.evaluate(() => window.__fullshot.dims());
  check('capture is full-page tall (h > 5000)', dims.h > 5000, `w=${dims.w} h=${dims.h}`);

  // --- save the stitched capture and scan for the fixed header appearing once ---
  const id = new URL(editor.url()).searchParams.get('id');
  const scan = await editor.evaluate(async (id) => {
    const blob = await new Promise((res, rej) => {
      const r = indexedDB.open('fullshot', 1);
      r.onsuccess = () => {
        const tx = r.result.transaction('captures', 'readonly');
        const g = tx.objectStore('captures').get(id);
        g.onsuccess = () => res(g.result.blob);
        g.onerror = () => rej(g.error);
      };
      r.onerror = () => rej(r.error);
    });
    const bmp = await createImageBitmap(blob);
    const cvs = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cvs.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    // Count rows that are almost entirely the dark header color (#111827).
    let darkRows = 0;
    const midX = Math.floor(bmp.width / 2) * 4;
    for (let y = 0; y < bmp.height; y++) {
      const i = y * bmp.width * 4 + midX;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < 40) darkRows++;
    }
    // base64 of the blob for saving to disk
    const buf = await blob.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    return { darkRows, w: bmp.width, h: bmp.height, b64: btoa(bin) };
  }, id);
  writeFileSync(join(OUT, 'capture.png'), Buffer.from(scan.b64, 'base64'));
  // One header band ~60px tall; duplication across ~11 tiles would be ~660+. Allow generous margin.
  check('fixed header not duplicated (dark rows < 160)', scan.darkRows < 160, `darkRows=${scan.darkRows}`);

  // --- drive the editor tools ---
  const box = await editor.$('.upper-canvas');
  const bb = await box.boundingBox();
  // The fit-to-width canvas is far taller than the viewport, so draw with small absolute pixel
  // offsets from its top-left corner — coordinates guaranteed to stay on-screen.
  const drawRect = async (x1, y1, x2, y2) => {
    await editor.mouse.move(bb.x + x1, bb.y + y1);
    await editor.mouse.down();
    await editor.mouse.move(bb.x + x2, bb.y + y2, { steps: 12 });
    await editor.mouse.up();
    await sleep(150);
  };

  await editor.evaluate(() => window.__fullshot.setTool('rect'));
  await drawRect(120, 60, 380, 150);
  check('box tool adds an object', (await editor.evaluate(() => window.__fullshot.objectCount())) === 1);

  await editor.evaluate(() => window.__fullshot.setTool('redact'));
  await drawRect(140, 220, 400, 300);
  check('redact tool adds an object', (await editor.evaluate(() => window.__fullshot.objectCount())) === 2);

  await editor.evaluate(() => window.__fullshot.canvas.discardActiveObject());
  await editor.keyboard.press('Control+z');
  await sleep(200);
  check('undo removes last object', (await editor.evaluate(() => window.__fullshot.objectCount())) === 1);
  await editor.keyboard.press('Control+Shift+z');
  await sleep(200);
  check('redo restores object', (await editor.evaluate(() => window.__fullshot.objectCount())) === 2);

  // --- exports: spy on chrome.downloads and verify real file signatures ---
  await editor.evaluate(() => {
    window.__dl = [];
    chrome.downloads.download = async (opts) => {
      const res = await fetch(opts.url);
      const buf = await res.arrayBuffer();
      window.__dl.push({ filename: opts.filename, head: Array.from(new Uint8Array(buf.slice(0, 5))), size: buf.byteLength });
      return 1;
    };
  });

  await editor.click('#export-png');
  await editor.waitForFunction(() => window.__dl.some((d) => d.filename.endsWith('.png')), { timeout: 15000 });
  await editor.click('#export-pdf');
  await editor.waitForFunction(() => window.__dl.some((d) => d.filename.endsWith('.pdf')), { timeout: 30000 });

  const dls = await editor.evaluate(() => window.__dl);
  const png = dls.find((d) => d.filename.endsWith('.png'));
  const pdf = dls.find((d) => d.filename.endsWith('.pdf'));
  check('PNG export has PNG signature', png && png.head[0] === 137 && png.head[1] === 80 && png.head[2] === 78 && png.head[3] === 71, JSON.stringify(png?.head));
  check('PDF export has %PDF signature', pdf && pdf.head[0] === 37 && pdf.head[1] === 80 && pdf.head[2] === 68 && pdf.head[3] === 70, `size=${pdf?.size}`);

  exitCode = results.every((r) => r.ok) ? 0 : 1;
} catch (err) {
  console.error('E2E ERROR:', err);
  check('harness ran without throwing', false, String(err && err.message));
  exitCode = 1;
} finally {
  await context.close();
  server.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(exitCode);

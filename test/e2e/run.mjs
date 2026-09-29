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
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { decodePng, checkLongPage, checkPdf, LONG_H, near } from './verify.mjs';

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
// Start from a fresh profile: a kept profile can hold the previous build's service worker and
// keyboard shortcuts, so a run would test old code.
rmSync(userDataDir, { recursive: true, force: true });
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

  // --- Quick export: the same capture, encoded and saved by the service worker ---
  // Chrome's service worker has no URL.createObjectURL, so these downloads use data: URLs; spy on
  // chrome.downloads.download there and keep the bytes for checking.
  await sw.evaluate(() => {
    self.__dl = [];
    chrome.downloads.download = async (opts) => {
      const buf = new Uint8Array(await (await fetch(opts.url)).arrayBuffer());
      let bin = '';
      for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
      self.__dl.push({ filename: opts.filename, scheme: opts.url.slice(0, opts.url.indexOf(':')), b64: btoa(bin) });
      return 1;
    };
  });
  await page.bringToFront();
  await sleep(300);
  const cssWidth = await page.evaluate(() => Math.max(window.innerWidth, document.documentElement.scrollWidth));
  for (const mode of ['png', 'jpeg', 'pdf']) {
    const err = await sw.evaluate((m) => self.__fullshotTest(m).then(() => null, (e) => String(e && e.message)), mode);
    check(`Quick ${mode.toUpperCase()} completes`, err === null, err ?? '');
  }
  const quick = await sw.evaluate(() => self.__dl.map((d) => ({ filename: d.filename, scheme: d.scheme, b64: d.b64 })));
  const qPng = quick.find((d) => d.filename.endsWith('.png'));
  const qJpg = quick.find((d) => d.filename.endsWith('.jpg'));
  const qPdf = quick.find((d) => d.filename.endsWith('.pdf'));
  if (qPng) {
    const buf = Buffer.from(qPng.b64, 'base64');
    writeFileSync(join(OUT, 'quick.png'), buf);
    const problems = checkLongPage(decodePng(buf), 1, cssWidth);
    check('Quick PNG is the complete page', !problems.length, problems.join('; ') || `${cssWidth}x${LONG_H}`);
  } else check('Quick PNG is the complete page', false, 'no PNG download');
  check('Quick JPEG has JPEG signature', qJpg && qJpg.b64.startsWith('/9j/'), qJpg?.filename ?? 'no JPEG download');
  if (qPdf) {
    const info = checkPdf(Buffer.from(qPdf.b64, 'base64'));
    check('Quick PDF holds the complete page', info.pages > 1 && Math.abs(info.totalH - LONG_H) <= 2, `pages=${info.pages} imgH=${info.totalH}`);
  } else check('Quick PDF holds the complete page', false, 'no PDF download');

  // --- visible area: one captureVisibleTab, cropped to the viewport without the scrollbar ---
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.bringToFront();
  await sleep(300);
  const viewport = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    return { w: se.clientWidth, h: se.clientHeight, innerWidth: window.innerWidth };
  });
  await sw.evaluate(() => { self.__dl = []; });
  const visErr = await sw.evaluate(() => self.__fullshotTest('png', 'visible').then(() => null, (e) => String(e && e.message)));
  check('Visible capture completes', visErr === null, visErr ?? '');
  const visDl = await sw.evaluate(() => self.__dl.map((d) => ({ filename: d.filename, b64: d.b64 })));
  if (visDl.length === 1) {
    const buf = Buffer.from(visDl[0].b64, 'base64');
    writeFileSync(join(OUT, 'visible.png'), buf);
    const png = decodePng(buf);
    check('Visible capture is the viewport without the scrollbar', png.width === viewport.w && png.height === viewport.h,
      `${png.width}x${png.height}, viewport ${viewport.w}x${viewport.h}, innerWidth ${viewport.innerWidth}`);
    check('Visible capture shows the fixed header', near(png.at(10, 10), [17, 24, 39], 12), JSON.stringify(png.at(10, 10)));
    check('Visible capture right edge is page, not scrollbar', near(png.at(png.width - 1, 300), [255, 255, 255], 8),
      JSON.stringify(png.at(png.width - 1, 300)));
  } else check('Visible capture is the viewport without the scrollbar', false, `${visDl.length} downloads`);

  // --- selected area: drag on the page, then one captureVisibleTab cropped to the rectangle ---
  await sw.evaluate(() => { self.__dl = []; });
  const childrenBefore = await page.evaluate(() => document.documentElement.children.length);
  const areaErr = await sw.evaluate(() => self.__fullshotTest('png', 'area').then(() => null, (e) => String(e && e.message)));
  check('Area selection starts', areaErr === null, areaErr ?? '');
  check('Area overlay is shown', (await page.evaluate(() => document.documentElement.children.length)) === childrenBefore + 1);
  await page.mouse.move(100, 150);
  await page.mouse.down();
  await page.mouse.move(400, 350, { steps: 10 });
  await page.mouse.up();
  for (let i = 0; i < 40 && (await sw.evaluate(() => self.__dl.length)) === 0; i++) await sleep(250);
  const areaDl = await sw.evaluate(() => self.__dl.map((d) => ({ filename: d.filename, b64: d.b64 })));
  if (areaDl.length === 1) {
    const buf = Buffer.from(areaDl[0].b64, 'base64');
    writeFileSync(join(OUT, 'area.png'), buf);
    const png = decodePng(buf);
    check('Area capture has the dragged size', png.width === 300 && png.height === 200, `${png.width}x${png.height}`);
    // x 100-400, y 150-350 is plain section-1 background (#e0f2fe) on the fixture.
    const corners = [png.at(0, 0), png.at(299, 0), png.at(0, 199), png.at(299, 199), png.at(150, 100)];
    check('Area capture shows the page, not the overlay', corners.every((p) => near(p, [224, 242, 254], 10)), JSON.stringify(corners));
  } else check('Area capture has the dragged size', false, `${areaDl.length} downloads`);
  check('Area overlay is removed', (await page.evaluate(() => document.documentElement.children.length)) === childrenBefore);

  // --- Escape cancels a selection: no capture, no overlay left ---
  await sw.evaluate(() => { self.__dl = []; });
  await sw.evaluate(() => self.__fullshotTest('png', 'area'));
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(1000);
  const cancelled = await sw.evaluate(() => self.__dl.length);
  const childrenAfter = await page.evaluate(() => document.documentElement.children.length);
  check('Escape cancels the area selection', cancelled === 0 && childrenAfter === childrenBefore, `downloads=${cancelled}`);

  // --- another capture while the area overlay is open: the overlay goes first ---
  await sw.evaluate(() => { self.__dl = []; });
  await sw.evaluate(() => self.__fullshotTest('png', 'area'));
  await sleep(200);
  const overErr = await sw.evaluate(() => self.__fullshotTest('png', 'visible').then(() => null, (e) => String(e && e.message)));
  const overDl = await sw.evaluate(() => self.__dl.map((d) => d.b64));
  // The overlay dims the page, so the white right edge would be grey.
  const overEdge = overDl.length === 1 ? decodePng(Buffer.from(overDl[0], 'base64')).at(viewport.w - 1, 300) : null;
  check('A capture during an area selection does not show the overlay',
    overErr === null && overEdge && near(overEdge, [255, 255, 255], 8) &&
      (await page.evaluate(() => document.documentElement.children.length)) === childrenBefore,
    `${overErr ?? ''} downloads=${overDl.length} edge=${JSON.stringify(overEdge)}`);

  // --- the overlay works above the page's modal dialog, and the page gets none of its events ---
  await page.evaluate(() => {
    window.__seen = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      document.addEventListener(type, (e) => window.__seen.push(e.type));
    }
    const dialog = document.createElement('dialog');
    dialog.id = 'page-dialog';
    dialog.textContent = 'Page dialog';
    document.body.append(dialog);
    dialog.showModal();
  });
  await sw.evaluate(() => { self.__dl = []; });
  await sw.evaluate(() => self.__fullshotTest('png', 'area'));
  await sleep(200);
  await page.mouse.move(100, 150);
  await page.mouse.down();
  await page.mouse.move(400, 350, { steps: 10 });
  await page.mouse.up();
  for (let i = 0; i < 40 && (await sw.evaluate(() => self.__dl.length)) === 0; i++) await sleep(250);
  const modalDl = await sw.evaluate(() => self.__dl.map((d) => d.b64));
  const modalPng = modalDl.length === 1 ? decodePng(Buffer.from(modalDl[0], 'base64')) : null;
  check('Area selection works above a modal dialog of the page', modalPng && modalPng.width === 300 && modalPng.height === 200,
    modalPng ? `${modalPng.width}x${modalPng.height}` : `${modalDl.length} downloads`);
  const seen = await page.evaluate(() => window.__seen);
  check('The page gets no pointer or click events from the selection', seen.length === 0, seen.slice(0, 8).join(','));
  await page.evaluate(() => document.getElementById('page-dialog').remove());

  // --- Enter works when the focus is in a frame; the frame gets no keys; the focus comes back ---
  await page.evaluate(() => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.id = 'page-frame';
    frame.style.cssText = 'position: fixed; left: 950px; top: 200px; width: 200px; height: 80px;';
    frame.srcdoc = '<input id="field">';
    frame.onload = resolve;
    document.body.append(frame);
  }));
  const child = page.frames().find((f) => f.parentFrame() === page.mainFrame());
  await child.focus('#field');
  await child.evaluate(() => {
    window.__keys = [];
    for (const type of ['keydown', 'keyup']) document.addEventListener(type, (e) => window.__keys.push(`${e.type}:${e.key}`));
  });
  await sw.evaluate(() => { self.__dl = []; });
  await sw.evaluate(() => self.__fullshotTest('png', 'area'));
  await sleep(200);
  await page.keyboard.press('Enter');
  for (let i = 0; i < 40 && (await sw.evaluate(() => self.__dl.length)) === 0; i++) await sleep(250);
  const enterDl = await sw.evaluate(() => self.__dl.map((d) => d.b64));
  const enterPng = enterDl.length === 1 ? decodePng(Buffer.from(enterDl[0], 'base64')) : null;
  check('Enter selects the visible area when the focus was in a frame',
    enterPng && enterPng.width === viewport.w && enterPng.height === viewport.h,
    enterPng ? `${enterPng.width}x${enterPng.height}` : `${enterDl.length} downloads`);
  // Chromium clears the focused element inside a frame whenever the focus leaves the frame (as
  // for any focus() call in the top page), so only the frame itself can get the focus back.
  const frameKeys = await child.evaluate(() => window.__keys);
  const topFocus = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  check('The frame gets no keys, and gets the focus back', frameKeys.length === 0 && topFocus === 'page-frame',
    `keys=${frameKeys.join(',')} focus=${topFocus}`);
  await page.evaluate(() => document.getElementById('page-frame').remove());

  // --- a classic scrollbar on the left (Firefox with a right-to-left UI): the crop starts after it ---
  const leftCrop = await sw.evaluate(async () => {
    const canvas = new OffscreenCanvas(100, 50);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000'; // the scrollbar
    ctx.fillRect(0, 0, 15, 50);
    ctx.fillStyle = '#0000ff'; // the page
    ctx.fillRect(15, 0, 85, 50);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const metrics = { viewportWidth: 85, viewportHeight: 50, viewportLeft: 15, innerWidth: 100, devicePixelRatio: 1 };
    const out = await self.__fullshotCrop(`data:image/png;base64,${btoa(bin)}`, metrics, { x: 0, y: 0, width: 85, height: 50 });
    const row = out.canvas.getContext('2d').getImageData(0, 0, out.width, 1).data;
    return { width: out.width, first: Array.from(row.slice(0, 4)), last: Array.from(row.slice(-4)) };
  });
  check('Crop starts after a scrollbar on the left', leftCrop.width === 85 && near(leftCrop.first, [0, 0, 255], 2) &&
    near(leftCrop.last, [0, 0, 255], 2), JSON.stringify(leftCrop));

  // --- in Chrome, a left border on <html> is page content, not a scrollbar ---
  await page.evaluate(() => { document.documentElement.style.borderLeft = '15px solid rgb(255, 0, 0)'; });
  await sw.evaluate(() => { self.__dl = []; });
  const borderErr = await sw.evaluate(() => self.__fullshotTest('png', 'visible').then(() => null, (e) => String(e && e.message)));
  const borderDl = await sw.evaluate(() => self.__dl.map((d) => d.b64));
  const borderPng = borderDl.length === 1 ? decodePng(Buffer.from(borderDl[0], 'base64')) : null;
  check('Visible capture keeps a left border of the page', borderErr === null && borderPng &&
    near(borderPng.at(0, 300), [255, 0, 0], 8) && near(borderPng.at(borderPng.width - 1, 300), [255, 255, 255], 8),
    borderPng ? `${JSON.stringify(borderPng.at(0, 300))} ${JSON.stringify(borderPng.at(borderPng.width - 1, 300))}` : borderErr ?? '');
  await page.evaluate(() => { document.documentElement.style.borderLeft = ''; });

  // --- popup: the scope choice changes the main button; it always opens on "Full page" ---
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/index.html`);
  const popupState = async () => popup.evaluate(() => ({
    scope: document.querySelector('input[name="scope"]:checked').value,
    title: document.getElementById('capture-title').textContent,
  }));
  const initial = await popupState();
  await popup.check('input[name="scope"][value="visible"]');
  const visible = await popupState();
  await popup.check('input[name="scope"][value="area"]');
  const areaState = await popupState();
  check('Popup opens on full page', initial.scope === 'full' && initial.title === 'Capture full page', JSON.stringify(initial));
  check('Popup scope switches the main button', visible.title === 'Capture visible area' && areaState.title === 'Select an area',
    `${visible.title} / ${areaState.title}`);
  const hint = await popup.textContent('#shortcut-hint');
  check('Popup lists the shortcuts', /Alt\+Shift\+V/.test(hint) && /Alt\+Shift\+S/.test(hint), hint);
  await popup.close();
  await page.bringToFront();
  await sleep(300);

  // --- one capture at a time: a second request while one runs is refused, not interleaved ---
  const second = await sw.evaluate(async () => {
    const first = self.__fullshotTest('png');
    const other = await self.__fullshotTest('png').then(() => 'started', (e) => String(e && e.message));
    await first;
    return other;
  });
  check('Concurrent capture request is refused', /already running/i.test(second), second);
  const pageAfter = await page.evaluate(() => ({ y: window.scrollY, header: getComputedStyle(document.getElementById('fixed-header')).visibility }));
  check('Page restored after capture', pageAfter.y === 0 && pageAfter.header === 'visible', JSON.stringify(pageAfter));

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

/**
 * Generates Chrome Web Store screenshots (1280x800) from the running extension:
 *   1) the editor with a real full-page capture + annotations
 *   2) the popup, composited onto a branded backdrop
 *
 * Run:  npm run build:test && xvfb-run -a node test/e2e/screenshots.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const EXT = join(ROOT, 'dist-test');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = join(ROOT, 'store-assets');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fixtures = join(ROOT, 'test/fixtures');
const server = http.createServer((req, res) => {
  try {
    const body = readFileSync(join(fixtures, decodeURIComponent(req.url.split('?')[0])));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(join(ROOT, 'test/e2e/out/profile-shots'), {
  headless: false,
  executablePath: CHROME,
  viewport: null,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run', '--no-default-browser-check',
    '--force-device-scale-factor=1', '--window-size=1300,900', '--hide-scrollbars',
  ],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  for (let i = 0; i < 40 && !(await sw.evaluate(() => !!self.__fullshotTest).catch(() => false)); i++) await sleep(250);

  // --- capture the fixture and open the editor ---
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${base}/long-page.html`, { waitUntil: 'load' });
  await page.bringToFront();
  await sleep(400);
  const editorPromise = context.waitForEvent('page', { predicate: (p) => p.url().includes('/src/editor/'), timeout: 90000 });
  await sw.evaluate(async () => { await self.__fullshotTest('edit'); });
  const editor = await editorPromise;
  await editor.waitForLoadState('domcontentloaded');
  await editor.waitForFunction(() => window.__fullshot && window.__fullshot.dims().h > 0, { timeout: 30000 });
  await editor.setViewportSize({ width: 1280, height: 800 });
  await sleep(300);

  // --- annotate for a compelling shot ---
  const bb = await (await editor.$('.upper-canvas')).boundingBox();
  await editor.fill('#width', '6').catch(() => {});
  const drag = async (x1, y1, x2, y2) => {
    await editor.mouse.move(bb.x + x1, bb.y + y1);
    await editor.mouse.down();
    await editor.mouse.move(bb.x + x2, bb.y + y2, { steps: 14 });
    await editor.mouse.up();
    await sleep(150);
  };
  await editor.evaluate(() => window.__fullshot.setTool('redact'));
  await drag(150, 250, 470, 320);
  await editor.evaluate(() => window.__fullshot.setTool('arrow'));
  await drag(560, 300, 380, 150);
  await editor.evaluate(() => window.__fullshot.setTool('text'));
  await editor.mouse.click(bb.x + 580, bb.y + 300);
  await sleep(150);
  await editor.keyboard.type('Full page in one shot');
  await editor.keyboard.press('Escape');
  await editor.evaluate(() => window.__fullshot.setTool('select'));
  await editor.evaluate(() => window.__fullshot.canvas.discardActiveObject() && window.__fullshot.canvas.requestRenderAll());
  await sleep(300);
  await editor.screenshot({ path: join(OUT, 'screenshot-1-editor.png'), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  console.log('wrote screenshot-1-editor.png');

  // --- popup composited onto a backdrop ---
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/index.html`, { waitUntil: 'load' });
  await popup.setViewportSize({ width: 320, height: 300 });
  await sleep(300);
  const popupPng = (await popup.screenshot()).toString('base64');

  const composer = await context.newPage();
  await composer.setViewportSize({ width: 1280, height: 800 });
  await composer.setContent('<canvas id="c" width="1280" height="800"></canvas><style>html,body{margin:0}</style>');
  const dataUrl = await composer.evaluate(async (b64) => {
    const cvs = document.getElementById('c');
    const x = cvs.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1280, 800);
    g.addColorStop(0, '#0f172a'); g.addColorStop(1, '#134e4a');
    x.fillStyle = g; x.fillRect(0, 0, 1280, 800);
    x.fillStyle = 'rgba(255,255,255,0.92)';
    x.font = '700 54px Arial'; x.fillText('One click.', 120, 300);
    x.fillText('The whole page.', 120, 372);
    x.fillStyle = 'rgba(226,232,240,0.85)'; x.font = '400 26px Arial';
    x.fillText('Capture, annotate, export — all on your device.', 122, 428);
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const pw = img.width, ph = img.height, px = 820, py = 260;
    x.save(); x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 40; x.shadowOffsetY = 18;
    x.fillStyle = '#0b1220';
    const r = 14; x.beginPath();
    x.moveTo(px + r, py); x.arcTo(px + pw, py, px + pw, py + ph, r); x.arcTo(px + pw, py + ph, px, py + ph, r);
    x.arcTo(px, py + ph, px, py, r); x.arcTo(px, py, px + pw, py, r); x.closePath(); x.fill(); x.restore();
    x.drawImage(img, px, py);
    return cvs.toDataURL('image/png');
  }, popupPng);
  writeFileSync(join(OUT, 'screenshot-2-popup.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote screenshot-2-popup.png');
} finally {
  await context.close();
  server.close();
}

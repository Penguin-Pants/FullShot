/**
 * Generates the Chrome Web Store images into docs/chrome-web-store/:
 *
 *   screenshot-1-capture.png   1280x800  popup open over a page
 *   screenshot-2-editor.png    1280x800  editor with annotations
 *   screenshot-3-full-page.png 1280x800  the visible area next to the stitched full-page capture
 *   screenshot-4-area.png      1280x800  area selection on the page
 *   screenshot-5-private.png   1280x800  local-only promise, popup and options page
 *   promo-small-440x280.png    small promo tile (required)
 *   promo-marquee-1400x560.png marquee promo tile (optional)
 *   store-icon-128.png         store icon: the 96x96 artwork with 16px transparent padding
 *
 * Every product UI in the images is a real screenshot of the extension (test build), taken on a
 * fictional demo page (test/fixtures/store-demo.html). The browser window around it, the
 * headlines and the backdrop are drawn by this script.
 *
 * Run:  npm run store:assets   (builds dist-test, then runs this file under xvfb)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const EXT = join(ROOT, 'dist-test');
const CHROME = process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = join(ROOT, 'docs/chrome-web-store');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const png64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

// The page area inside the drawn browser window, in CSS pixels.
const FRAME_W = 1120;
const FRAME_H = 600;
const DEMO_URL_TEXT = 'northbound-notes.example/trails/coastal-trail';

const fixtures = join(ROOT, 'test/fixtures');
const server = http.createServer((req, res) => {
  try {
    const body = readFileSync(join(fixtures, decodeURIComponent(req.url.split('?')[0])));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = join(ROOT, 'test/e2e/out/profile-shots');
rmSync(profile, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: CHROME,
  viewport: null,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run', '--no-default-browser-check',
    '--force-device-scale-factor=1', `--window-size=${FRAME_W + 16},900`, '--hide-scrollbars',
  ],
});

/** Brand styles and the browser-window mockup shared by every composed image. */
const icon128 = png64(readFileSync(join(ROOT, 'public/icons/icon128.png')));
const icon32 = png64(readFileSync(join(ROOT, 'public/icons/icon32.png')));
const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: 'Liberation Sans', Arial, sans-serif; color: #f8fafc; overflow: hidden; }
  .bg { position: absolute; inset: 0; overflow: hidden;
    background: radial-gradient(1200px 700px at 85% 0%, #115e59 0%, rgba(17,94,89,0) 60%),
                linear-gradient(135deg, #0b1220 0%, #0f172a 45%, #0c3b3a 100%); }
  .glow { position: absolute; border-radius: 50%; filter: blur(60px); opacity: 0.45; }
  h1 { margin: 0; font-size: 46px; line-height: 1.1; font-weight: 700; letter-spacing: -0.6px; }
  h1 em { font-style: normal; background: linear-gradient(90deg, #2dd4bf, #38bdf8); -webkit-background-clip: text; color: transparent; }
  .sub { margin-top: 12px; font-size: 21px; color: #cbd5e1; }
  .win { position: absolute; background: #fff; border-radius: 14px 14px 0 0; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08); }
  .win__tabs { height: 38px; background: #dfe3e8; display: flex; align-items: flex-end; padding: 0 12px; gap: 8px; }
  .dots { display: flex; gap: 7px; align-self: center; margin-right: 10px; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; background: #b8bfc8; display: block; }
  .tab { height: 30px; min-width: 230px; background: #fff; border-radius: 9px 9px 0 0; display: flex; align-items: center;
    gap: 8px; padding: 0 14px; font-size: 13px; color: #334155; }
  .tab img, .tab .fav { width: 16px; height: 16px; border-radius: 4px; }
  .fav { background: linear-gradient(135deg, #f0a35e, #d9822b); }
  .win__bar { height: 42px; background: #fff; display: flex; align-items: center; gap: 12px; padding: 0 12px;
    border-bottom: 1px solid #e2e8f0; }
  .nav { display: flex; gap: 14px; color: #94a3b8; font-size: 17px; width: 70px; }
  .url { flex: 1; height: 30px; border-radius: 15px; background: #f1f5f9; display: flex; align-items: center;
    padding: 0 14px; font-size: 14px; color: #475569; gap: 8px; }
  .url b { font-weight: 400; color: #0f172a; }
  .lock { width: 10px; height: 12px; border: 2px solid #64748b; border-radius: 2px; position: relative; top: 1px; }
  .ext { display: flex; gap: 10px; align-items: center; }
  .ext i { width: 18px; height: 18px; border-radius: 50%; background: #e2e8f0; display: block; }
  .ext .fs { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #ccfbf1; }
  .ext .fs img { width: 20px; height: 20px; }
  .win__page { display: block; }
  .shadow { box-shadow: 0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(15,23,42,0.18); border-radius: 12px; }
`;

function browserWindow({ x, y, w = FRAME_W, pageImg, pageH, tabTitle, tabIcon, url, active = false }) {
  const fav = tabIcon ? `<img src="${tabIcon}">` : '<span class="fav"></span>';
  return `
  <div class="win" style="left:${x}px; top:${y}px; width:${w}px;">
    <div class="win__tabs"><div class="dots"><i></i><i></i><i></i></div>
      <div class="tab">${fav}<span>${tabTitle}</span></div></div>
    <div class="win__bar"><div class="nav">&#8592; &#8594; &#8635;</div>
      <div class="url"><span class="lock"></span><b>${url}</b></div>
      <div class="ext"><i></i><span class="fs" style="${active ? 'box-shadow:0 0 0 2px #14b8a6' : ''}"><img src="${icon32}"></span><i></i></div>
    </div>
    <img class="win__page" src="${pageImg}" style="width:${w}px; height:${pageH ?? 'auto'}${pageH ? 'px' : ''};">
  </div>`;
}

/** Renders `html` at w x h and writes it as a PNG. */
async function compose(name, w, h, html) {
  const p = await context.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
    <body style="width:${w}px;height:${h}px;position:relative">${html}</body></html>`);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await sleep(150);
  writeFileSync(join(OUT, name), await p.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
  await p.close();
  console.log('wrote', name);
}

/** A headline over the backdrop, then a browser window that runs off the bottom edge. */
function heroLayout({ title, sub, windowHtml, extra = '' }) {
  return `<div class="bg"><div class="glow" style="width:520px;height:520px;left:-160px;top:420px;background:#0ea5e9"></div>
    <div class="glow" style="width:420px;height:420px;right:-120px;top:-160px;background:#14b8a6"></div></div>
    <div style="position:absolute;left:80px;top:48px;right:80px">
      <h1>${title}</h1><div class="sub">${sub}</div></div>
    ${windowHtml}${extra}`;
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  for (let i = 0; i < 40 && !(await sw.evaluate(() => !!self.__fullshotTest).catch(() => false)); i++) await sleep(250);

  // --- 1) a real full-page capture of the demo page, opened in the editor ---
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${base}/store-demo.html`, { waitUntil: 'load' });
  await page.bringToFront();
  await sleep(500);
  const editorPromise = context.waitForEvent('page', { predicate: (p) => p.url().includes('/src/editor/'), timeout: 90000 });
  await sw.evaluate(async () => { await self.__fullshotTest('edit'); });
  const editor = await editorPromise;
  await editor.waitForLoadState('domcontentloaded');
  await editor.waitForFunction(() => window.__fullshot && window.__fullshot.dims().h > 0, { timeout: 30000 });

  // The stitched image itself, read back from the editor's IndexedDB hand-off.
  const captureId = new URL(editor.url()).searchParams.get('id');
  const fullCapture = await editor.evaluate(async (id) => {
    const blob = await new Promise((res, rej) => {
      const r = indexedDB.open('fullshot', 1);
      r.onsuccess = () => {
        const g = r.result.transaction('captures', 'readonly').objectStore('captures').get(id);
        g.onsuccess = () => res(g.result.blob);
        g.onerror = () => rej(g.error);
      };
      r.onerror = () => rej(r.error);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    return `data:${blob.type};base64,${btoa(bin)}`;
  }, captureId);
  const captureDims = await editor.evaluate(() => window.__fullshot.dims());
  console.log('full-page capture', captureDims);

  // --- 2) the page as a person sees it, and with the area selection open ---
  await page.setViewportSize({ width: FRAME_W, height: FRAME_H });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  const pageTop = await page.screenshot();
  // Scroll the facts row near the top, then drag a rectangle that the drawn window shows in full.
  const factsTop = await page.evaluate(() => document.querySelector('.facts').getBoundingClientRect().top + scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), factsTop - 150);
  await sleep(300);
  await page.bringToFront();
  await sw.evaluate(async () => { await self.__fullshotTest('png', 'area'); });
  await sleep(400);
  const box = await page.evaluate(() => {
    const f = document.querySelector('.facts').getBoundingClientRect();
    const h = document.querySelector('article h2').getBoundingClientRect();
    return { x1: f.left - 16, y1: f.top - 16, x2: f.right + 16, y2: h.bottom + 16 };
  });
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 12 });
  await sleep(300);
  const pageArea = await page.screenshot();
  await page.mouse.up();
  await sleep(800);

  // --- 3) annotate in the editor ---
  // A wider editor keeps its toolbar on one row; the image is scaled down into the drawn window.
  const EDITOR_W = 1344;
  const EDITOR_H = Math.round((EDITOR_W / FRAME_W) * FRAME_H);
  await editor.bringToFront();
  await editor.setViewportSize({ width: EDITOR_W, height: EDITOR_H });
  await sleep(400);
  const zoom = await editor.evaluate(() => window.__fullshot.canvas.getZoom());
  // Document coordinates of the parts to annotate, measured on the demo page at the capture width.
  await page.setViewportSize({ width: captureDims.w, height: FRAME_H });
  await page.evaluate(() => window.scrollTo(0, 0));
  const spots = await page.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height };
    };
    const byline = document.querySelector('.byline');
    // Only the two names in the byline, not the date.
    const range = document.createRange();
    range.setStart(byline.firstChild, 3);
    range.setEnd(byline.firstChild, byline.textContent.indexOf(' · Updated'));
    return { names: r(range), fact3: r(document.querySelector('.fact:nth-child(3)')), h2: r(document.querySelector('article h2')) };
  });
  // Scroll the editor so the byline is near the top of the stage.
  await editor.evaluate((y) => { document.getElementById('stage').scrollTop = y; }, Math.round((spots.names.y - 24) * zoom));
  await sleep(300);
  const cbb = await (await editor.$('.upper-canvas')).boundingBox();
  const at = (x, y) => ({ x: cbb.x + x * zoom, y: cbb.y + y * zoom });
  const drag = async (a, b) => {
    await editor.mouse.move(a.x, a.y);
    await editor.mouse.down();
    await editor.mouse.move(b.x, b.y, { steps: 16 });
    await editor.mouse.up();
    await sleep(200);
  };
  const tool = (t) => editor.evaluate((t) => window.__fullshot.setTool(t), t);
  // Pixelate the names in the byline.
  await tool('redact');
  await drag(at(spots.names.x - 4, spots.names.y - 3), at(spots.names.x + spots.names.w + 4, spots.names.y + spots.names.h + 3));
  // Highlight the section heading.
  await editor.fill('#width', '9').catch(() => {});
  await editor.evaluate(() => { const c = document.getElementById('color'); c.value = '#facc15'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  await tool('highlight');
  const hy = spots.h2.y + spots.h2.h / 2;
  await drag(at(spots.h2.x - 4, hy), at(spots.h2.x + 330, hy));
  // A box around the total climb, an arrow and a note in the empty space right of the heading.
  await editor.fill('#width', '5').catch(() => {});
  await editor.evaluate(() => { const c = document.getElementById('color'); c.value = '#ef4444'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  await tool('rect');
  const f = spots.fact3;
  await drag(at(f.x - 8, f.y - 8), at(f.x + f.w + 8, f.y + f.h + 8));
  const noteX = f.x + f.w * 0.55;
  const noteY = spots.h2.y + 6;
  await tool('arrow');
  await drag(at(noteX + 40, noteY - 4), at(f.x + f.w * 0.6, f.y + f.h + 14));
  await tool('text');
  const tp = at(noteX + 60, noteY - 8);
  await editor.mouse.click(tp.x, tp.y);
  await sleep(200);
  await editor.keyboard.type('Hardest day');
  await editor.keyboard.press('Escape');
  await sleep(150);
  await tool('select');
  await editor.evaluate(() => { window.__fullshot.canvas.discardActiveObject(); window.__fullshot.canvas.requestRenderAll(); });
  // Show the Box tool as the active one, as it would be while marking up.
  await tool('rect');
  await editor.mouse.move(cbb.x + 5, cbb.y + 5);
  await sleep(400);
  const editorShot = await editor.screenshot();

  // --- 4) popup and options page ---
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 400 });
  await popup.goto(`chrome-extension://${extId}/src/popup/index.html`, { waitUntil: 'load' });
  await sleep(300);
  const popupH = await popup.evaluate(() => document.body.scrollHeight);
  const popupShot = await popup.screenshot({ clip: { x: 0, y: 0, width: 300, height: popupH } });
  const options = await context.newPage();
  await options.setViewportSize({ width: 760, height: 520 });
  await options.goto(`chrome-extension://${extId}/src/options/index.html`, { waitUntil: 'load' });
  await sleep(400);
  const optionsShot = await options.screenshot();

  // ---------------- compose the store images ----------------
  const pageTitle = 'Seven Days on the Coastal Trail';

  await compose('screenshot-1-capture.png', 1280, 800, heroLayout({
    title: 'Capture the <em>whole page</em> in one click',
    sub: 'Full page, visible area or a selected area. Save as PNG, JPEG or PDF.',
    windowHtml: browserWindow({ x: 80, y: 190, pageImg: png64(pageTop), tabTitle: pageTitle, url: DEMO_URL_TEXT, active: true }),
    extra: `<img class="shadow" src="${png64(popupShot)}" style="position:absolute;left:${80 + FRAME_W - 300 - 44}px;top:${190 + 80 + 4}px;width:300px">`,
  }));

  await compose('screenshot-2-editor.png', 1280, 800, heroLayout({
    title: '<em>Mark it up</em> before you save',
    sub: 'Crop, pixelate, arrows, boxes, ellipses, text, pen and highlighter.',
    windowHtml: browserWindow({ x: 80, y: 190, pageImg: png64(editorShot), tabTitle: 'FullShot — Editor', tabIcon: icon32, url: 'FullShot editor' }),
  }));

  // The visible area on the left, the stitched capture (scaled to fit) on the right.
  const stripH = 700;
  const stripW = Math.round((captureDims.w / captureDims.h) * stripH);
  await compose('screenshot-3-full-page.png', 1280, 800, `
    <div class="bg"><div class="glow" style="width:520px;height:520px;left:-160px;top:420px;background:#0ea5e9"></div></div>
    <div style="position:absolute;left:80px;top:70px;width:600px">
      <h1>The <em>whole page</em>,<br>not just the screen</h1>
      <div class="sub">FullShot scrolls the page and joins every part into one image. A fixed header shows once, at the top.</div>
    </div>
    <div style="position:absolute;left:80px;top:330px;width:${Math.round(FRAME_W * 0.62)}px">
      <div style="font-size:15px;color:#94a3b8;margin-bottom:10px;letter-spacing:1px;text-transform:uppercase">What you see</div>
      <img class="shadow" src="${png64(pageTop)}" style="width:100%;display:block">
    </div>
    <div style="position:absolute;left:${1280 - 90 - stripW - 40}px;top:50px;font-size:15px;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;writing-mode:vertical-rl;transform:rotate(180deg);height:${stripH}px;text-align:center">What FullShot saves</div>
    <img class="shadow" src="${fullCapture}" style="position:absolute;right:90px;top:50px;height:${stripH}px;width:${stripW}px;border-radius:6px">
    <div style="position:absolute;right:${90 + stripW + 12}px;top:50px;height:${stripH}px;width:14px;border:3px solid #2dd4bf;border-right:0;border-radius:6px 0 0 6px"></div>
  `);

  await compose('screenshot-4-area.png', 1280, 800, heroLayout({
    title: 'Or drag to capture <em>one area</em>',
    sub: 'Enter takes the visible area. Esc cancels. Shortcuts: Alt+Shift+S and Alt+Shift+V.',
    windowHtml: browserWindow({ x: 80, y: 190, pageImg: png64(pageArea), tabTitle: pageTitle, url: DEMO_URL_TEXT, active: true }),
  }));

  const point = (t, s) => `<div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:26px">
      <div style="flex:none;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#14b8a6,#0ea5e9);display:grid;place-items:center;font-weight:700;color:#06231f">&#10003;</div>
      <div><div style="font-size:22px;font-weight:700">${t}</div><div style="font-size:17px;color:#cbd5e1;margin-top:4px">${s}</div></div></div>`;
  await compose('screenshot-5-private.png', 1280, 800, `
    <div class="bg"><div class="glow" style="width:520px;height:520px;right:-160px;top:380px;background:#0ea5e9"></div></div>
    <div style="position:absolute;left:80px;top:70px;width:520px">
      <h1>Everything stays<br><em>on your device</em></h1>
      <div style="margin-top:40px">
        ${point('No account, no upload', 'Captures are made, edited and saved in your browser.')}
        ${point('No tracking', 'No analytics, no ads and no remote code.')}
        ${point('Access only when you click', 'FullShot uses activeTab: it can read a tab only after you start a capture.')}
        ${point('Free and open source', 'MIT License. No watermark.')}
      </div>
    </div>
    <img class="shadow" src="${png64(optionsShot)}" style="position:absolute;left:640px;top:150px;width:560px">
    <img class="shadow" src="${png64(popupShot)}" style="position:absolute;left:870px;top:${800 - popupH - 40}px;width:300px">
  `);

  // Promo tiles: the brand, not a screenshot (store guidance: little text, strong colors, full bleed).
  const tallPage = (x, y, w, h) => `
    <div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:10px;overflow:hidden;background:#fff;
      box-shadow:0 20px 50px rgba(0,0,0,0.45)">
      <img src="${fullCapture}" style="width:100%;display:block"></div>
    <div style="position:absolute;left:${x - 12}px;top:${y - 12}px;width:${w + 24}px;height:${h + 24}px;border:4px solid #fff;border-radius:16px;opacity:0.95"></div>`;
  const tileBg = `<div class="bg" style="background:linear-gradient(135deg,#0d9488 0%,#0ea5e9 100%)">
      <div class="glow" style="width:360px;height:360px;left:-120px;top:-140px;background:#5eead4;opacity:0.5"></div>
      <div class="glow" style="width:380px;height:380px;right:-140px;bottom:-200px;background:#1e3a8a;opacity:0.45"></div></div>`;
  const smallStripW = 120;
  await compose('promo-small-440x280.png', 440, 280, `${tileBg}
    <img src="${icon128}" style="position:absolute;left:34px;top:62px;width:72px;height:72px">
    <div style="position:absolute;left:34px;top:150px;font-size:40px;font-weight:700;letter-spacing:-0.8px">FullShot</div>
    <div style="position:absolute;left:36px;top:200px;font-size:17px;color:#e0f2fe">Full page screenshots</div>
    ${tallPage(440 - 40 - smallStripW, 26, smallStripW, 280)}
  `);
  await compose('promo-marquee-1400x560.png', 1400, 560, `${tileBg}
    <img src="${icon128}" style="position:absolute;left:110px;top:150px;width:112px;height:112px">
    <div style="position:absolute;left:110px;top:290px;font-size:78px;font-weight:700;letter-spacing:-1.5px">FullShot</div>
    <div style="position:absolute;left:114px;top:390px;font-size:28px;color:#e0f2fe">Capture, mark up and save whole web pages</div>
    <img class="shadow" src="${png64(editorShot)}" style="position:absolute;left:900px;top:80px;width:720px;border-radius:12px">
    ${tallPage(760, 40, 190, 560)}
  `);
} finally {
  await context.close();
  server.close();
}

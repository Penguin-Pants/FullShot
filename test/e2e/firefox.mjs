/**
 * Firefox end-to-end harness for FullShot.
 *
 * Drives a real Firefox through Marionette (the protocol is built in, so no geckodriver or
 * Selenium is needed) and exercises the PRODUCTION build under the real activeTab model:
 *
 *  - the toolbar button and the popup buttons are clicked with OS-level (native) mouse events,
 *    so Firefox grants activeTab exactly as it does for a real user click;
 *  - no test hooks and no extra host permissions are compiled in;
 *  - every export is verified from the downloaded file (PNG pixels, PDF structure), not from
 *    in-page state.
 *
 * Run (Firefox 140+ required, a display is required for native events):
 *   npm run build:firefox
 *   FIREFOX_BIN=/path/to/firefox xvfb-run -a -s "-screen 0 2600x2000x24" node test/e2e/firefox.mjs
 *
 * Options (environment variables):
 *   FULLSHOT_EXT_DIR   extension directory to install (default: dist-firefox)
 *   REPEAT             repetitions for the repeated-export scenarios (default: 10)
 *   ONLY               comma-separated scenario names to run (default: all)
 *   FIREFOX_OUT        output directory for logs/downloads/results (default: test/e2e/out/firefox)
 *   EDITOR_BASELINE    output directory of an earlier run: editorTools must match its exports
 */
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, openSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { decodePng, checkLongPage, checkPdf, near, LONG_H, changedPixels, redOverlap } from './verify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const FIREFOX_BIN = process.env.FIREFOX_BIN;
const EXT = resolve(ROOT, process.env.FULLSHOT_EXT_DIR ?? 'dist-firefox');
const OUT = resolve(ROOT, process.env.FIREFOX_OUT ?? 'test/e2e/out/firefox');
const REPEAT = Number(process.env.REPEAT ?? 10);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const EDITOR_BASELINE = process.env.EDITOR_BASELINE ? resolve(ROOT, process.env.EDITOR_BASELINE) : null;

/**
 * The editorTools exports of an earlier run, by file name. main() reads them before it clears OUT,
 * because the earlier run may have written them to that same folder.
 */
let editorBaseline = null;
function readEditorBaseline() {
  if (!EDITOR_BASELINE) return null;
  const files = existsSync(EDITOR_BASELINE) ? readdirSync(EDITOR_BASELINE).filter((f) => /^editor-.+\.png$/.test(f)) : [];
  return new Map(files.map((f) => [f, readFileSync(join(EDITOR_BASELINE, f))]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 160) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s);

/* ----------------------------- fixture server ----------------------------- */

const LONG = readFileSync(join(ROOT, 'test/fixtures/long-page.html'), 'utf8');
const VARIANTS = {
  // Standards-mode page: 40px in-flow sticky nav + 100px padding + 12 sections of 700px = 8540 CSS px.
  long: LONG,
  // Same content without a doctype: the document renders in quirks mode.
  quirks: LONG.replace(/^<!doctype html>\s*/i, ''),
  // Same content with smooth scrolling forced by the page.
  smooth: LONG.replace('</style>', 'html { scroll-behavior: smooth !important; }\n    </style>'),
  // 60 sections (42,140 CSS px): taller than a canvas may be, and slow enough to capture that the
  // capture outlasts Firefox's 30 s idle timeout for event pages.
  verylong: LONG.replace(/(<section>2<\/section>)/, '$1' + '<section>x</section>'.repeat(48)),
  // The document itself does not scroll; an inner element does (web-app layout).
  nested: LONG.replace('</style>', 'html, body { height: 100%; overflow: hidden; } main { height: 100%; overflow: auto; }\n    </style>'),
  // Appends sections whenever the user nears the bottom (infinite scroll), up to 30 extra.
  infinite: LONG.replace('</body>', `<script>
    let added = 0;
    addEventListener('scroll', () => {
      if (added < 30 && scrollY + innerHeight > document.documentElement.scrollHeight - 200) {
        for (let i = 0; i < 3; i++, added++) document.querySelector('main').insertAdjacentHTML('beforeend', '<section>+</section>');
      }
    });
  </script></body>`),
  // Shorter than any viewport.
  short:
    '<!doctype html><html><head><meta charset="utf-8"><title>short</title><style>' +
    'html,body{margin:0}body{background:#ecfccb}#box{height:300px;background:#65a30d}' +
    '</style></head><body><div id="box"></div></body></html>',
  // One viewport of fine checkerboard, so every editor tool (pixelation too) changes pixels.
  editor:
    '<!doctype html><html><head><meta charset="utf-8"><title>editor</title><style>' +
    'html,body{margin:0;height:100%}' +
    'body{background:repeating-conic-gradient(#cbd5e1 0 25%,#f8fafc 0 50%) 0 0/16px 16px}' +
    '</style></head><body></body></html>',
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const name = url.pathname.replace(/^\/|\.html$/g, '');
    const delay = Number(url.searchParams.get('delay') ?? 0);
    if (!(name in VARIANTS)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    if (delay) await sleep(delay);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(VARIANTS[name]);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/* ------------------------------ Marionette ------------------------------ */

class Marionette {
  constructor(port) {
    this.port = port;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolveHello, reject) => {
      this.sock = net.connect(this.port, '127.0.0.1');
      this.sock.on('error', reject);
      this.sock.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        for (;;) {
          const colon = this.buf.indexOf(58);
          if (colon < 0) return;
          const len = Number(this.buf.subarray(0, colon).toString());
          if (this.buf.length < colon + 1 + len) return;
          const packet = JSON.parse(this.buf.subarray(colon + 1, colon + 1 + len).toString('utf8'));
          this.buf = this.buf.subarray(colon + 1 + len);
          if (!Array.isArray(packet)) {
            resolveHello(packet);
            continue;
          }
          const [, id, error, result] = packet;
          const p = this.pending.get(id);
          if (!p) continue;
          this.pending.delete(id);
          if (error) p.reject(Object.assign(new Error(`${error.error}: ${error.message}`), error));
          else p.resolve(result);
        }
      });
    });
  }

  send(name, params = {}) {
    const id = this.nextId++;
    const data = Buffer.from(JSON.stringify([0, id, name, params]), 'utf8');
    this.sock.write(`${data.length}:`);
    this.sock.write(data);
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }

  async exec(script, ...args) {
    const r = await this.send('WebDriver:ExecuteScript', { script, args });
    return r?.value;
  }

  async context(value) {
    await this.send('Marionette:SetContext', { value });
  }

  async chrome(script, ...args) {
    await this.context('chrome');
    return this.exec(CHROME_PRELUDE + script, ...args);
  }

  async content(script, ...args) {
    await this.context('content');
    return this.exec(script, ...args);
  }
}

/**
 * Helpers evaluated in the browser's chrome (parent-process) scope. They read Firefox's own
 * activeTab bookkeeping (the same fields scripting.executeScript and captureVisibleTab check) and
 * read the popup's text and button positions through the accessibility tree, which the parent
 * process mirrors for remote documents.
 */
const CHROME_PRELUDE = `
  const wu = window.windowUtils;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const A = Ci.nsIAccessibleRole;
  // warp=true moves the pointer first (hover → Firefox's real popup-preload path). Inside the
  // popup the pointer is not warped: under Xvfb (no window manager) X focus follows the pointer,
  // so warping into the panel would blur the main window and roll the panel up. GTK button events
  // carry their own coordinates, so the click still lands on the popup element.
  async function nativeClickAt(sx, sy, el, warp = true) {
    const msgs = [wu.NATIVE_MOUSE_MESSAGE_BUTTON_DOWN, wu.NATIVE_MOUSE_MESSAGE_BUTTON_UP];
    if (warp) msgs.unshift(wu.NATIVE_MOUSE_MESSAGE_MOVE);
    for (const m of msgs) {
      try {
        wu.sendNativeMouseEvent(sx, sy, m, 0, 0, el, null);
      } catch (e) {
        throw new Error('native mouse event failed at ' + sx + ',' + sy + ' on ' + (el && el.localName) +
          ' screen=' + window.mozInnerScreenX + ',' + window.mozInnerScreenY + ' dpr=' + window.devicePixelRatio + ': ' + e.message);
      }
      await sleep(60);
    }
  }
  async function nativeClickEl(el) {
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    await nativeClickAt(Math.round((window.mozInnerScreenX + r.left + r.width / 2) * dpr),
      Math.round((window.mozInnerScreenY + r.top + r.height / 2) * dpr), el);
  }
  function widgetIdFor(id) { return id.toLowerCase().replace(/[^a-z0-9_-]/g, '_') + '-browser-action'; }
  function actionButton(id) {
    const node = document.getElementById(widgetIdFor(id));
    return node && (node.querySelector('.unified-extensions-item-action-button') || node);
  }
  function popupBrowser() {
    const b = document.querySelector('.webextension-popup-browser');
    return b && b.isConnected && b.getBoundingClientRect().height > 50 ? b : null;
  }
  function accRoot(b) {
    const svc = Cc['@mozilla.org/accessibilityService;1'].getService(Ci.nsIAccessibilityService);
    return svc.getAccessibleFor(b);
  }
  function walk(a, fn) { if (!a) return; fn(a); for (let c = a.firstChild; c; c = c.nextSibling) walk(c, fn); }
  function popupTexts() {
    const b = popupBrowser();
    if (!b) return null;
    const out = [];
    walk(accRoot(b), (a) => { if (a.role === A.ROLE_TEXT_LEAF) out.push(a.name); });
    return out;
  }
  function popupButtonBounds() {
    const b = popupBrowser();
    if (!b) return null;
    const found = {};
    walk(accRoot(b), (a) => {
      if (a.role !== A.ROLE_PUSHBUTTON) return;
      const x = {}, y = {}, w = {}, h = {};
      a.getBounds(x, y, w, h);
      const name = (a.name || '').trim();
      const key = name.startsWith('Capture full page') ? 'edit' : name.toLowerCase();
      found[key] = { x: x.value + w.value / 2, y: y.value + h.value / 2 };
    });
    return found;
  }
  function permState(id, nativeTab = gBrowser.selectedTab) {
    const ext = WebExtensionPolicy.getByID(id).extension;
    const tab = ext.tabManager.getWrapper(nativeTab);
    return {
      url: nativeTab.linkedBrowser.currentURI.spec,
      innerWindowID: tab.innerWindowID,
      activeTabWindowID: tab.activeTabWindowID,
      granted: tab.hasActiveTabPermission,
    };
  }
`;

/* ------------------------------ Firefox session ------------------------------ */

let sessionCount = 0;

async function launch({ dpr = 1, width = 1200, height = 900, prefs: extraPrefs = {}, openBeforeInstall } = {}) {
  const n = ++sessionCount;
  const profile = join(OUT, `profile-${n}`);
  const dl = join(OUT, `downloads-${n}`);
  mkdirSync(profile, { recursive: true });
  mkdirSync(dl, { recursive: true });
  const prefs = {
    'marionette.port': 0,
    'browser.download.folderList': 2,
    'browser.download.dir': dl,
    'browser.download.useDownloadDir': true,
    'browser.download.always_ask_before_handling_new_types': false,
    'browser.download.open_pdf_attachments_inline': false,
    'pdfjs.disabled': true,
    'browser.shell.checkDefaultBrowser': false,
    'devtools.console.stdout.content': true,
    'devtools.console.stdout.chrome': true,
    'layout.css.devPixelsPerPx': String(dpr),
    'accessibility.force_disabled': -1,
    // Xvfb has no window manager, so X input focus follows the pointer: moving it into the popup
    // would blur the main window and roll the panel up. Real desktops don't do that; this is the
    // same setting Mozilla's own automation (geckodriver) uses.
    'focusmanager.testmode': true,
    ...extraPrefs,
  };
  writeFileSync(join(profile, 'user.js'),
    Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  const logPath = join(OUT, `firefox-${n}.log`);
  const log = openSync(logPath, 'w');
  const proc = spawn(FIREFOX_BIN, ['--marionette', '--remote-allow-system-access', '--no-remote', '--foreground', '--profile', profile], {
    stdio: ['ignore', log, log],
    env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: '1' },
  });
  const portFile = join(profile, 'MarionetteActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(100);
  const port = Number(readFileSync(portFile, 'utf8').trim());
  const m = new Marionette(port);
  await m.connect();
  await m.send('WebDriver:NewSession', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  await m.send('WebDriver:SetTimeouts', { script: 600000, pageLoad: 120000, implicit: 0 });
  await m.send('WebDriver:SetWindowRect', { x: 0, y: 0, width, height });
  if (openBeforeInstall) await m.send('WebDriver:Navigate', { url: openBeforeInstall });
  const installed = await m.send('Addon:Install', { path: EXT, temporary: true });
  const id = installed?.value ?? installed;
  const s = { m, proc, dl, id, dpr, logPath, n };
  // onInstalled opens the options page; close it like a user would, and pin the button.
  await sleep(1500);
  await closeExtraTabs(s);
  await m.chrome(`
    CustomizableUI.addWidgetToArea(widgetIdFor(arguments[0]), CustomizableUI.AREA_NAVBAR);
  `, id);
  await sleep(300);
  return s;
}

async function quit(s) {
  try { await s.m.send('Marionette:Quit', { flags: ['eForceQuit'] }); } catch { /* already gone */ }
  await sleep(500);
  try { s.proc.kill('SIGKILL'); } catch { /* exited */ }
}

async function windowHandles(s) {
  const r = await s.m.send('WebDriver:GetWindowHandles');
  return Array.isArray(r) ? r : r?.value ?? [];
}

async function closeExtraTabs(s) {
  await s.m.chrome(`
    const keep = gBrowser.tabs[0];
    for (const t of [...gBrowser.tabs]) if (t !== keep) gBrowser.removeTab(t);
    gBrowser.selectedTab = keep;
  `);
  const handles = await windowHandles(s);
  await s.m.send('WebDriver:SwitchToWindow', { handle: handles[0], focus: true });
}

async function gotoPage(s, url) {
  await s.m.context('content');
  await s.m.send('WebDriver:Navigate', { url });
  await sleep(300);
}

async function openPopup(s) {
  return s.m.chrome(`
    return (async () => {
      const id = arguments[0];
      if (popupBrowser()) { CustomizableUI.hidePanelForNode(popupBrowser()); await sleep(300); }
      await nativeClickEl(actionButton(id));
      for (let i = 0; i < 60; i++) {
        const b = popupButtonBounds();
        const panel = popupBrowser()?.closest('panel');
        if (b && b.png && panel && panel.state === 'open') {
          await sleep(250); // let the panel widget finish mapping before native clicks
          return { perm: permState(id), buttons: popupButtonBounds() };
        }
        await sleep(100);
      }
      return { perm: permState(id), buttons: null };
    })();
  `, s.id);
}

async function clickPopup(s, key) {
  return s.m.chrome(`
    return (async () => {
      const b = popupButtonBounds();
      if (!b || !b[arguments[0]]) return false;
      await nativeClickAt(Math.round(b[arguments[0]].x), Math.round(b[arguments[0]].y), popupBrowser(), false);
      return true;
    })();
  `, key);
}

async function closePopup(s) {
  await s.m.chrome(`if (popupBrowser()) CustomizableUI.hidePanelForNode(popupBrowser());`);
  await sleep(300);
}

const STATIC_POPUP_TEXT = new Set(['FullShot', 'Capture full page', 'Scroll, stitch & open the editor',
  'QUICK EXPORT', 'Quick export', 'PNG', 'JPEG', 'PDF', 'Options', 'Shortcut: Alt+Shift+P']);

async function popupStatus(s) {
  const texts = await s.m.chrome(`return popupTexts();`);
  if (!texts) return null;
  return texts.filter((t) => !STATIC_POPUP_TEXT.has(t)).join(' ');
}

// Progress and success texts: keep waiting for the file (the popup can report success a moment
// before the download finishes writing).
const isProgress = (t) => !t || /^(Preparing|Capturing|Done|Working|Saving|Saved|Opened|Opening)/.test(t);

function listDownloads(s) {
  return readdirSync(s.dl).filter((f) => !f.endsWith('.part'));
}

/** Wait for a new finished download or a popup error. */
async function waitOutcome(s, before, { timeout = 90000, ext } = {}) {
  const t0 = Date.now();
  let lastStatus = null;
  while (Date.now() - t0 < timeout) {
    const files = listDownloads(s).filter((f) => !before.includes(f) && (!ext || f.endsWith(ext)));
    if (files.length) {
      const p = join(s.dl, files[0]);
      let size = -1;
      for (let i = 0; i < 40; i++) {
        const now = statSync(p).size;
        if (now > 0 && now === size) break;
        size = now;
        await sleep(150);
      }
      await sleep(300);
      return { kind: 'download', file: files[0], path: p, ms: Date.now() - t0, status: lastStatus };
    }
    const st = await popupStatus(s).catch(() => null);
    if (st !== null) lastStatus = st;
    if (st && !isProgress(st)) return { kind: 'error', status: st, ms: Date.now() - t0 };
    await sleep(250);
  }
  return { kind: 'timeout', status: lastStatus, ms: Date.now() - t0 };
}

/** Expected capture width in CSS px: the page's scroll width, or the scrollbar-free viewport. */
async function viewportCssWidth(s) {
  return s.m.content(`return Math.max(window.innerWidth, document.documentElement.scrollWidth);`);
}

/* ------------------------------ scenarios ------------------------------ */

const results = [];
function record(scenario, attempt, ok, detail) {
  results.push({ scenario, attempt, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${scenario}${attempt != null ? ` #${attempt}` : ''}  ${short(detail, 300)}`);
}

/** "Capture full page" → wait for the editor → click the editor's own export button. */
async function exportViaEditor(s, fmt) {
  const ed = await openEditor(s);
  if (ed.kind !== 'editor') return ed;
  const out = await exportFromEditor(s, fmt);
  // Leave the content context on the page tab for callers that inspect it.
  await s.m.send('WebDriver:SwitchToWindow', { handle: ed.handles[0], focus: false });
  return out;
}

/** "Capture full page" → wait until the editor tab has loaded the capture; switches to that tab. */
async function openEditor(s) {
  const opened = await openPopup(s);
  if (!opened.buttons) return { kind: 'error', status: 'popup did not open' };
  await clickPopup(s, 'edit');
  let editorReady = false;
  for (let k = 0; k < 240 && !editorReady; k++) {
    await sleep(250);
    editorReady = await s.m.chrome(`return gBrowser.selectedBrowser.currentURI.spec.includes('/src/editor/');`);
    if (!editorReady) {
      const st = await popupStatus(s).catch(() => null);
      if (st && !isProgress(st)) return { kind: 'error', status: st };
    }
  }
  if (!editorReady) return { kind: 'timeout', status: 'editor did not open' };
  const handles = await windowHandles(s);
  await s.m.send('WebDriver:SwitchToWindow', { handle: handles[handles.length - 1], focus: true });
  await s.m.context('content');
  let loaded = false;
  for (let k = 0; k < 120 && !loaded; k++) {
    await sleep(250);
    loaded = await s.m.exec(`return document.getElementById('loading')?.hidden === true;`).catch(() => false);
  }
  if (!loaded) return { kind: 'timeout', status: 'editor did not load the capture' };
  return { kind: 'editor', handles };
}

/** Click one of the editor's export buttons (the editor tab must be current) and wait for the file. */
async function exportFromEditor(s, fmt) {
  const before = listDownloads(s);
  await s.m.content(`document.getElementById(arguments[0]).click();`, `export-${fmt === 'jpeg' ? 'jpg' : fmt}`);
  return waitOutcome(s, before, { ext: fmt === 'jpeg' ? '.jpg' : `.${fmt}` });
}

/**
 * Real input for the current tab through WebDriver actions: press the left button at the first
 * point, move through the others (in small steps, like a hand would) and release. One point is a
 * click. Points are viewport CSS px.
 */
async function pointerPath(s, points, steps = 6) {
  const pts = points.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const acts = [
    { type: 'pointerMove', origin: 'viewport', x: pts[0][0], y: pts[0][1], duration: 0 },
    { type: 'pointerDown', button: 0 },
  ];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    for (let k = 1; k <= steps; k++) {
      acts.push({ type: 'pointerMove', origin: 'viewport', duration: 10,
        x: Math.round(ax + ((bx - ax) * k) / steps), y: Math.round(ay + ((by - ay) * k) / steps) });
    }
  }
  acts.push({ type: 'pointerUp', button: 0 });
  await s.m.context('content');
  await s.m.send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: acts }] });
  await s.m.send('WebDriver:ReleaseActions', {});
  await sleep(200);
}

const KEY = { ctrl: '', escape: '', delete: '' };

/** Type keys into the focused element; an array entry is a chord (e.g. [KEY.ctrl, 'z']). */
async function typeKeys(s, keys) {
  const acts = [];
  for (const k of keys) {
    const chord = Array.isArray(k) ? k : [k];
    for (const c of chord) acts.push({ type: 'keyDown', value: c });
    for (const c of [...chord].reverse()) acts.push({ type: 'keyUp', value: c });
  }
  await s.m.context('content');
  await s.m.send('WebDriver:PerformActions', { actions: [{ type: 'key', id: 'keyboard', actions: acts }] });
  await s.m.send('WebDriver:ReleaseActions', {});
  await sleep(200);
}

/** One Quick Export from the popup; returns a verdict for the long page. */
async function quickExport(s, mode, { page = 'long', check = true, dpr = s.dpr, cssWidth } = {}) {
  let out;
  if (process.env.VIA === 'editor') {
    // Route the export through "Capture full page" + the editor's export button instead.
    out = await exportViaEditor(s, mode);
  } else {
    const before = listDownloads(s);
    const opened = await openPopup(s);
    if (!opened.buttons) return { ok: false, detail: `popup did not open (${JSON.stringify(opened.perm)})` };
    await clickPopup(s, mode);
    const ext = mode === 'jpeg' ? '.jpg' : mode === 'pdf' ? '.pdf' : '.png';
    out = await waitOutcome(s, before, { ext });
  }
  if (out.kind !== 'download') return { ok: false, detail: `${out.kind}: ${short(out.status)}`, out };
  const buf = readFileSync(out.path);
  if (!check) return { ok: true, detail: out.file, out };
  if (mode === 'pdf') {
    const pdf = checkPdf(buf);
    const expH = Math.round((page === 'short' ? 0 : LONG_H) * s.dpr);
    const problems = [...pdf.problems];
    if (expH && Math.abs(pdf.totalH - expH) > 2) problems.push(`PDF image height ${pdf.totalH} != ${expH}`);
    return { ok: !problems.length, detail: `${out.file} pages=${pdf.pages} imgH=${pdf.totalH} ${problems.join('; ')}`, out };
  }
  if (mode === 'jpeg') {
    const ok = buf[0] === 0xff && buf[1] === 0xd8;
    return { ok, detail: `${out.file} ${ok ? 'JPEG signature ok' : 'bad signature'}`, out };
  }
  const png = decodePng(buf);
  if (page !== 'long' && page !== 'quirks' && page !== 'smooth') return { ok: true, detail: `${out.file} ${png.width}x${png.height}`, out, png };
  const problems = checkLongPage(png, dpr, cssWidth ?? (await viewportCssWidth(s)));
  return { ok: !problems.length, detail: `${out.file} ${png.width}x${png.height} ${problems.join('; ')}`, out, png };
}

/** Return the user to the page tab (the editor tab opened by edit/pdf modes is closed). */
async function backToPage(s) {
  await closePopup(s);
  await closeExtraTabs(s);
}

const SCENARIOS = {
  async quickPngRepeated(base) {
    const s = await launch();
    try {
      await gotoPage(s, `${base}/long.html`);
      for (let i = 1; i <= REPEAT; i++) {
        const r = await quickExport(s, 'png');
        record('Quick PNG, long page', i, r.ok, r.detail);
        await backToPage(s);
      }
    } finally { await quit(s); }
  },

  async quickPdfRepeated(base) {
    const s = await launch();
    try {
      await gotoPage(s, `${base}/long.html`);
      for (let i = 1; i <= REPEAT; i++) {
        const r = await quickExport(s, 'pdf');
        record('Quick PDF, long page', i, r.ok, r.detail);
        await backToPage(s);
      }
    } finally { await quit(s); }
  },

  async quickJpegRepeated(base) {
    const s = await launch();
    try {
      await gotoPage(s, `${base}/long.html`);
      for (let i = 1; i <= Math.max(3, Math.ceil(REPEAT / 2)); i++) {
        const r = await quickExport(s, 'jpeg');
        record('Quick JPEG, long page', i, r.ok, r.detail);
        await backToPage(s);
      }
    } finally { await quit(s); }
  },

  async alternating(base) {
    const s = await launch();
    try {
      await gotoPage(s, `${base}/long.html`);
      const modes = ['png', 'pdf', 'png', 'pdf', 'jpeg', 'pdf', 'png'];
      for (let i = 0; i < modes.length; i++) {
        const r = await quickExport(s, modes[i]);
        record(`Alternating Quick ${modes[i].toUpperCase()}`, i + 1, r.ok, r.detail);
        await backToPage(s);
      }
    } finally { await quit(s); }
  },

  /** "Capture full page" → editor → the editor's own export buttons. */
  async normalExports(base) {
    const s = await launch();
    try {
      await gotoPage(s, `${base}/long.html`);
      const vw = await viewportCssWidth(s);
      for (let i = 1; i <= Math.max(2, Math.ceil(REPEAT / 2)); i++) {
        for (const fmt of ['png', 'pdf']) {
          const out = await exportViaEditor(s, fmt);
          if (out.kind !== 'download') {
            record(`Normal ${fmt.toUpperCase()}`, i, false, `${out.kind}: ${short(out.status)}`);
          } else if (fmt === 'png') {
            const png = decodePng(readFileSync(out.path));
            const problems = checkLongPage(png, s.dpr, vw);
            record(`Normal PNG`, i, !problems.length, `${png.width}x${png.height} ${problems.join('; ')}`);
          } else {
            const pdf = checkPdf(readFileSync(out.path));
            const ok = Math.abs(pdf.totalH - LONG_H * s.dpr) <= 2;
            record(`Normal PDF`, i, ok, `pages=${pdf.pages} imgH=${pdf.totalH}`);
          }
          await backToPage(s);
        }
      }
    } finally { await quit(s); }
  },

  // A PDF with the page address and date stamped on each page (an option, off by default). The
  // stamp is the one PDF feature that goes through jsPDF's text().
  async pdfStamp(base) {
    const s = await launch();
    try {
      const optionsUrl = await s.m.chrome(`return WebExtensionPolicy.getByID(arguments[0]).getURL('src/options/index.html');`, s.id);
      await gotoPage(s, optionsUrl);
      await s.m.content(`const c = document.getElementById('stamp'); if (!c.checked) c.click();`);
      await sleep(500);
      await gotoPage(s, `${base}/long.html`);
      const r = await quickExport(s, 'pdf');
      let { ok, detail } = r;
      if (r.out?.kind === 'download') {
        const buf = readFileSync(r.out.path);
        const { pages } = checkPdf(buf);
        const stamps = buf.toString('latin1').split(`${new URL(base).host}/long.html`).length - 1;
        ok = ok && pages > 0 && stamps === pages;
        detail += ` | stamped pages ${stamps} of ${pages}`;
      }
      record('Quick PDF with the URL and date stamp', null, ok, detail);
    } finally { await quit(s); }
  },

  // Every editor tool, driven with real pointer and key input. Each PNG export is checked against
  // the one before it: a tool may change pixels only where it drew, Delete must bring back the
  // page, Undo (which rebuilds the objects from saved JSON) must restore the image exactly and a
  // crop must keep the selected area. With EDITOR_BASELINE set to the output folder of an earlier
  // run, every export must also match that run pixel for pixel (proof that a library upgrade
  // changes nothing the user sees).
  async editorTools(base) {
    const s = await launch();
    try {
      await gotoPage(s, `${base}/editor.html`);
      const ed = await openEditor(s);
      if (ed.kind !== 'editor') return record('Editor tools', null, false, `${ed.kind}: ${short(ed.status)}`);
      const shots = {};
      const shot = async (label) => {
        const out = await exportFromEditor(s, 'png');
        if (out.kind !== 'download') throw new Error(`${label} export: ${out.kind} ${short(out.status)}`);
        const buf = readFileSync(out.path);
        writeFileSync(join(OUT, `editor-${label}.png`), buf);
        return (shots[label] = decodePng(buf));
      };
      const useTool = (tool) => s.m.content(`document.querySelector('.tool[data-tool="' + arguments[0] + '"]').click();`, tool);

      const blank = await shot('blank');
      // Where the canvas is, and which part of it can take input (the stage scrolls, the window ends).
      const box = await s.m.content(`
        const r = document.querySelector('.upper-canvas').getBoundingClientRect();
        const st = document.getElementById('stage').getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width,
          x0: Math.max(r.left, st.left, 0), x1: Math.min(r.right, st.right, innerWidth),
          y0: Math.max(r.top, st.top, 0), y1: Math.min(r.bottom, st.bottom, innerHeight) };
      `);
      const k = blank.width / box.width; // image px per CSS px
      const toImg = ([x, y]) => [(x - box.left) * k, (y - box.top) * k];
      // A 3 × 3 grid over the usable area; each tool draws in its own cell.
      const cellW = (box.x1 - box.x0) / 3;
      const cellH = (box.y1 - box.y0) / 3;
      const at = (col, row, fx, fy) => [box.x0 + (col + fx) * cellW, box.y0 + (row + fy) * cellH];
      const areas = {}; // image-px box each tool may change: [x0, y0, x1, y1]
      const area = (name, pts, pad) => {
        const img = pts.map(toImg);
        const xs = img.map((p) => p[0]);
        const ys = img.map((p) => p[1]);
        areas[name] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
      };
      const inArea = ([x0, y0, x1, y1], x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const draw = async (tool, pts, pad) => {
        await useTool(tool);
        await pointerPath(s, pts);
        area(tool, pts, pad);
      };

      await draw('rect', [at(0, 0, 0.2, 0.2), at(0, 0, 0.8, 0.8)], 4);
      await draw('ellipse', [at(1, 0, 0.2, 0.2), at(1, 0, 0.8, 0.8)], 4);
      await draw('arrow', [at(2, 0, 0.2, 0.8), at(2, 0, 0.8, 0.2)], 18); // the head reaches past the end point
      await draw('redact', [at(0, 1, 0.15, 0.15), at(0, 1, 0.85, 0.85)], 2);
      const textAt = at(1, 1, 0.1, 0.3);
      await useTool('text');
      await pointerPath(s, [textAt]);
      await typeKeys(s, [...'FullShot', KEY.escape]);
      const [tx, ty] = toImg(textAt);
      areas.text = [tx - 3, ty - 3, tx + 230, ty + 34]; // 20 px text in a 220 px wide box
      await draw('pen', [at(2, 1, 0.1, 0.5), at(2, 1, 0.3, 0.2), at(2, 1, 0.5, 0.8), at(2, 1, 0.7, 0.2), at(2, 1, 0.9, 0.5)], 5);
      await draw('highlight', [at(0, 2, 0.1, 0.5), at(0, 2, 0.5, 0.45), at(0, 2, 0.9, 0.5)], 11);
      const all = await shot('all');

      const hits = Object.fromEntries(Object.keys(areas).map((n) => [n, 0]));
      const stray = [];
      for (const [x, y] of changedPixels(all, blank)) {
        const name = Object.keys(areas).find((n) => inArea(areas[n], x, y));
        if (name) hits[name]++;
        else stray.push([x, y]);
      }
      record('Editor: each tool draws only where it was used', null,
        stray.length === 0 && Object.values(hits).every((n) => n >= 20),
        `changed px per tool ${JSON.stringify(hits)} | outside the tools' areas: ${stray.length}${stray.length ? ` e.g. ${JSON.stringify(stray.slice(0, 3))}` : ''}`);

      await useTool('select');
      await pointerPath(s, [at(0, 0, 0.5, 0.5)]); // inside the box: selects it
      await typeKeys(s, [KEY.delete]);
      const deleted = await shot('deleted');
      let wrong = 0;
      for (let y = 0; y < all.height; y++) {
        for (let x = 0; x < all.width; x++) {
          const ref = inArea(areas.rect, x, y) ? blank : all;
          const p = deleted.at(x, y);
          const q = ref.at(x, y);
          if (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2] || p[3] !== q[3]) wrong++;
        }
      }
      record('Editor: select + Delete removes only the box', null, wrong === 0, `pixels not as expected: ${wrong}`);

      await typeKeys(s, [[KEY.ctrl, 'z']]);
      const undone = await shot('undone');
      const undoDiff = changedPixels(undone, all).length;
      record('Editor: Undo restores the image exactly', null, undoDiff === 0, `pixels different from before Delete: ${undoDiff}`);

      const c0 = at(0, 0, 0.1, 0.1);
      const c1 = at(1, 1, 0.9, 0.9);
      await useTool('crop');
      await pointerPath(s, [c0, c1]);
      const cropped = await shot('cropped');
      const [cx0, cy0] = toImg(c0);
      const [cx1, cy1] = toImg(c1);
      // The crop starts at a fractional pixel, so the export is resampled: compare where the red
      // annotations are rather than exact pixels (a crop 3 px or more off overlaps well under 0.8).
      let best = { iou: -1 };
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const r = redOverlap(cropped, undone, Math.round(cx0) + ox, Math.round(cy0) + oy);
          if (r.iou > best.iou) best = { ...r, ox, oy };
        }
      }
      const sizeOk = Math.abs(cropped.width - (cx1 - cx0)) <= 2 && Math.abs(cropped.height - (cy1 - cy0)) <= 2;
      record('Editor: crop exports the selected area', null, sizeOk && best.red >= 500 && best.iou >= 0.8,
        `${cropped.width}x${cropped.height} expected ${Math.round(cx1 - cx0)}x${Math.round(cy1 - cy0)} | red overlap ${best.iou.toFixed(2)} at offset ${best.ox},${best.oy} (${best.red} red px)`);

      if (editorBaseline) {
        for (const label of Object.keys(shots)) {
          const buf = editorBaseline.get(`editor-${label}.png`);
          if (!buf) {
            record(`Editor: same pixels as baseline (${label})`, null, false, `missing editor-${label}.png in ${EDITOR_BASELINE}`);
            continue;
          }
          const ref = decodePng(buf);
          const cur = shots[label];
          const same = ref.width === cur.width && ref.height === cur.height;
          const diff = same ? changedPixels(cur, ref).length : -1;
          record(`Editor: same pixels as baseline (${label})`, null, same && diff === 0,
            same ? `different pixels: ${diff}` : `size ${cur.width}x${cur.height} vs baseline ${ref.width}x${ref.height}`);
        }
      }
    } finally { await quit(s); }
  },

  /** Page variants: short page, already scrolled, quirks mode, smooth scrolling, zoom. */
  async pageVariants(base) {
    const s = await launch();
    try {
      await gotoPage(s, `${base}/short.html`);
      let r = await quickExport(s, 'png', { page: 'short' });
      const vw = await viewportCssWidth(s);
      const vh = await s.m.content(`return document.documentElement.clientHeight;`);
      const shortOk = r.ok && r.png && r.png.width === vw && r.png.height === vh && near(r.png.at(50, 50), [101, 163, 13]);
      record('Short page → PNG (one viewport, no scrolling)', null, shortOk, `${r.detail} expected ${vw}x${vh}`);
      await backToPage(s);

      await gotoPage(s, `${base}/long.html`);
      await s.m.content(`window.scrollTo(0, 3000);`);
      r = await quickExport(s, 'png');
      const y = await s.m.content(`return window.scrollY;`);
      record('Already scrolled page → PNG (complete, scroll restored)', null, r.ok && y === 3000, `${r.detail} scrollY after=${y}`);
      await backToPage(s);

      await gotoPage(s, `${base}/quirks.html`);
      const mode = await s.m.content(`return document.compatMode;`);
      r = await quickExport(s, 'png', { page: 'quirks' });
      record(`Quirks-mode page (${mode}) → PNG`, null, r.ok, r.detail);
      await backToPage(s);

      await gotoPage(s, `${base}/smooth.html`);
      r = await quickExport(s, 'png', { page: 'smooth' });
      record('Page forcing smooth scrolling → PNG', null, r.ok, r.detail);
      await backToPage(s);

      await gotoPage(s, `${base}/long.html`);
      await s.m.chrome(`ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser, 1.5);`);
      await sleep(500);
      const zdpr = await s.m.content(`return window.devicePixelRatio;`);
      const zvw = await viewportCssWidth(s);
      r = await quickExport(s, 'png', { dpr: zdpr, cssWidth: zvw });
      record('Browser zoom 150% → PNG', null, r.ok, `${r.detail} dpr=${zdpr}`);
      await s.m.chrome(`ZoomManager.setZoomForBrowser(gBrowser.selectedBrowser, 1);`);
      await backToPage(s);
    } finally { await quit(s); }
  },

  async highDpi(base) {
    const s = await launch({ dpr: 2, width: 800, height: 700 });
    try {
      await gotoPage(s, `${base}/long.html`);
      for (let i = 1; i <= 3; i++) {
        const r = await quickExport(s, 'png');
        record('DPR 2 → Quick PNG', i, r.ok, r.detail);
        await backToPage(s);
      }
      const r = await quickExport(s, 'pdf');
      record('DPR 2 → Quick PDF', null, r.ok, r.detail);
      await backToPage(s);
    } finally { await quit(s); }
  },

  async windowSizes(base) {
    for (const [w, h] of [[800, 600], [1400, 1000]]) {
      const s = await launch({ width: w, height: h });
      try {
        await gotoPage(s, `${base}/long.html`);
        const r = await quickExport(s, 'png');
        record(`Window ${w}x${h} → Quick PNG`, null, r.ok, r.detail);
      } finally { await quit(s); }
    }
  },

  /**
   * privacy.resistFingerprinting spoofs window.devicePixelRatio in content, while captureVisibleTab
   * still captures at the real device scale. The capture must still line up.
   */
  async fingerprintingResistance(base) {
    const s = await launch({ prefs: { 'privacy.resistFingerprinting': true } });
    try {
      await gotoPage(s, `${base}/long.html`);
      const spoofed = await s.m.content(`return window.devicePixelRatio;`);
      const real = await s.m.chrome(`return window.devicePixelRatio;`);
      const r = await quickExport(s, 'png', { dpr: real });
      record('resistFingerprinting → PNG', null, r.ok, `${r.detail} (content dpr=${spoofed}, device dpr=${real})`);
      await backToPage(s);
    } finally { await quit(s); }
  },

  /** A page loaded before the extension was installed is captured the same way. */
  async pageBeforeInstall(base) {
    const s = await launch({ openBeforeInstall: `${base}/long.html` });
    try {
      const url = await s.m.content(`return location.pathname;`);
      const r = await quickExport(s, 'png');
      record('Page opened before install → Quick PNG', null, r.ok && url === '/long.html', `${url} ${r.detail}`);
    } finally { await quit(s); }
  },

  /** Two windows: each capture must come from the window whose toolbar button was clicked. */
  async multiWindow(base) {
    const s = await launch();
    try {
      await gotoPage(s, `${base}/short.html`);
      const first = (await windowHandles(s))[0];
      const opened = await s.m.send('WebDriver:NewWindow', { type: 'window' });
      const second = opened?.handle ?? opened?.value?.handle;
      await s.m.send('WebDriver:SwitchToWindow', { handle: second, focus: true });
      // Side by side: without a window manager, overlapping windows make it ambiguous which one
      // receives an OS-level click.
      await s.m.send('WebDriver:SetWindowRect', { x: 1300, y: 0, width: 1200, height: 900 });
      await gotoPage(s, `${base}/long.html`);
      await sleep(500);
      let r = await quickExport(s, 'png');
      record('Second window → Quick PNG captures that window', null, r.ok, r.detail);
      await closePopup(s);

      await s.m.send('WebDriver:SwitchToWindow', { handle: first, focus: true });
      await sleep(500);
      r = await quickExport(s, 'png', { page: 'short' });
      const ok = r.ok && r.png && near(r.png.at(50, 50), [101, 163, 13]);
      record('First window again → Quick PNG captures the first window', null, ok, r.detail);
    } finally { await quit(s); }
  },

  /**
   * Edge cases. A page taller than a canvas may be is scaled down (never clipped) and its long
   * capture must survive the event page's idle timeout. Pages FullShot cannot fully capture (an
   * inner scroll container, content that keeps growing) must still finish cleanly.
   */
  async edgeCases(base) {
    const s = await launch();
    const pageOk = () => s.m.content(`return window.scrollY === 0 && getComputedStyle(document.getElementById('fixed-header')).visibility === 'visible' && typeof window.__fullshot__ === 'undefined';`);
    try {
      await gotoPage(s, `${base}/verylong.html`);
      const fullH = await s.m.content(`return document.documentElement.scrollHeight;`);
      const t0 = Date.now();
      let r = await quickExport(s, 'png', { check: false });
      const secs = Math.round((Date.now() - t0) / 1000);
      let detail = r.detail;
      let ok = r.ok;
      if (r.ok) {
        const png = decodePng(readFileSync(r.out.path));
        const k = png.height / fullH;
        // Bottom marker section (the last one) must be there: sample its background near the end.
        const last = png.at(Math.round(200 * k), png.height - Math.round(350 * k));
        ok = png.height === 32767 && Math.abs(png.width - Math.round(1200 * k)) <= 1 && near(last, [252, 231, 243]);
        detail = `${png.width}x${png.height} for a ${fullH}px page (scaled ${k.toFixed(3)}), last section ${last.slice(0, 3)} , ${secs}s`;
      }
      record('Very long page → PNG (scaled to canvas limit, complete, > 30 s capture)', null, ok && (await pageOk()), detail);
      await backToPage(s);

      r = await quickExport(s, 'pdf', { check: false });
      if (r.ok) {
        const pdf = checkPdf(readFileSync(r.out.path));
        record('Very long page → PDF', null, pdf.pages > 20 && pdf.totalH === 32767, `pages=${pdf.pages} imgH=${pdf.totalH}`);
      } else record('Very long page → PDF', null, false, r.detail);
      await backToPage(s);

      await gotoPage(s, `${base}/nested.html`);
      r = await quickExport(s, 'png', { check: false });
      if (r.ok) {
        const png = decodePng(readFileSync(r.out.path));
        const vh = await s.m.content(`return document.documentElement.clientHeight;`);
        record('Inner scroll container → finishes (viewport only: known limitation)', null, png.height < 2 * vh && (await pageOk()), `${png.width}x${png.height} (viewport ${vh}px)`);
      } else record('Inner scroll container → finishes (viewport only: known limitation)', null, false, r.detail);
      await backToPage(s);

      await gotoPage(s, `${base}/infinite.html`);
      r = await quickExport(s, 'png', { check: false });
      if (r.ok) {
        const png = decodePng(readFileSync(r.out.path));
        record('Infinite scroll → finishes at the height measured at start', null, png.height === LONG_H, `${png.width}x${png.height}`);
      } else record('Infinite scroll → finishes at the height measured at start', null, false, r.detail);
      await backToPage(s);
    } finally { await quit(s); }
  },

  /**
   * activeTab lifecycle. Firefox grants activeTab for the document a tab shows when the toolbar
   * button is clicked, and revokes it as soon as that document is replaced. After a reload or a
   * navigation the only correct outcome is a clear request to click the button again, never the
   * raw "Missing host permission for the tab". Everything else must simply work.
   */
  async lifecycle(base) {
    const s = await launch();
    const asksForNewClick = (out) => out.kind === 'error' && /click the FullShot button again/i.test(out.status ?? '');
    const pageState = () => s.m.content(`return { y: window.scrollY,
      header: getComputedStyle(document.getElementById('fixed-header')).visibility,
      leftover: typeof window.__fullshot__ };`);
    try {
      // 1) Popup opened, then the page reloads before the user picks a format.
      await gotoPage(s, `${base}/long.html`);
      let before = listDownloads(s);
      let o = await openPopup(s);
      await s.m.chrome(`gBrowser.selectedBrowser.reload();`);
      await sleep(1500);
      const permAfterReload = await s.m.chrome(`return permState(arguments[0]);`, s.id);
      await clickPopup(s, 'png');
      let out = await waitOutcome(s, before, { ext: '.png', timeout: 30000 });
      record('Reload after popup opened → clear message', null, asksForNewClick(out),
        `${out.kind}: ${short(out.status)} | activeTab before=${o.perm.granted} after reload=${permAfterReload.granted}`);
      await backToPage(s);

      // 2) Toolbar clicked while a navigation is still loading (old document still shown).
      await gotoPage(s, `${base}/short.html`);
      before = listDownloads(s);
      await s.m.content(`location.href = arguments[0];`, `${base}/long.html?delay=2500`);
      await sleep(300);
      o = await openPopup(s);
      await sleep(3500); // the new document commits and loads
      const permAfterNav = await s.m.chrome(`return permState(arguments[0]);`, s.id);
      await clickPopup(s, 'png');
      out = await waitOutcome(s, before, { ext: '.png', timeout: 30000 });
      record('Popup opened during page load → clear message', null, asksForNewClick(out),
        `${out.kind}: ${short(out.status)} | granted for ${o.perm.url} → now ${permAfterNav.url} granted=${permAfterNav.granted}`);
      await backToPage(s);

      // 3) Reload, then capture (a fresh toolbar click grants the new document).
      await gotoPage(s, `${base}/long.html`);
      await s.m.context('content');
      await s.m.send('WebDriver:Refresh');
      let r = await quickExport(s, 'png');
      record('Reload, then Quick PNG', null, r.ok, r.detail);
      await backToPage(s);

      // 4) Navigate to another page, then capture.
      await gotoPage(s, `${base}/short.html`);
      await gotoPage(s, `${base}/long.html`);
      r = await quickExport(s, 'png');
      record('Navigate, then Quick PNG', null, r.ok, r.detail);
      await backToPage(s);

      // 5) Switch to another tab and back, then capture.
      await s.m.chrome(`gBrowser.selectedTab = gBrowser.addTab('about:blank', { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`);
      await sleep(400);
      await s.m.chrome(`gBrowser.selectedTab = gBrowser.tabs[0];`);
      await sleep(400);
      r = await quickExport(s, 'png');
      record('Switch tabs and back, then Quick PNG', null, r.ok, r.detail);
      await backToPage(s);

      // 6) Quick PDF, then Quick PNG without touching the tabs: both must work.
      await gotoPage(s, `${base}/long.html`);
      const r1 = await quickExport(s, 'pdf');
      const active = await s.m.chrome(`return gBrowser.selectedBrowser.currentURI.spec;`);
      const r2 = await quickExport(s, 'png');
      record('Quick PDF, then Quick PNG without switching tabs', null, r1.ok && r2.ok && !active.startsWith('moz-extension:'),
        `PDF: ${r1.detail} | active tab after PDF: ${short(active, 60)} | PNG: ${r2.detail}`);
      await backToPage(s);

      // 7) The user switches tabs while the capture is running.
      await gotoPage(s, `${base}/long.html`);
      await s.m.chrome(`gBrowser.addTab('about:blank', { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`);
      before = listDownloads(s);
      await openPopup(s);
      await clickPopup(s, 'png');
      await sleep(1500);
      await s.m.chrome(`gBrowser.selectedTab = gBrowser.tabs[1];`);
      out = await waitOutcome(s, before, { ext: '.png', timeout: 45000 });
      await sleep(500);
      let page = await pageState();
      let detail = `${out.kind}: ${short(out.status)} | page after: scrollY=${page.y} header=${page.header} state=${page.leftover}`;
      let ok = out.kind === 'error' && /switched/i.test(out.status ?? '');
      if (out.kind === 'download') {
        const problems = checkLongPage(decodePng(readFileSync(out.path)), s.dpr, await viewportCssWidth(s));
        detail += ` (downloaded despite the switch: ${problems.join('; ') || 'image intact'})`;
        ok = !problems.length;
      }
      ok = ok && page.y === 0 && page.header === 'visible' && page.leftover === 'undefined';
      record('Tab switched during capture → clear message, page restored', null, ok, detail);
      await backToPage(s);

      // 8) Popup closed mid-capture, reopened, and another export requested.
      await gotoPage(s, `${base}/long.html`);
      before = listDownloads(s);
      await openPopup(s);
      await clickPopup(s, 'png');
      await sleep(1200);
      await closePopup(s);
      await openPopup(s);
      await clickPopup(s, 'pdf');
      const secondStatus = await popupStatus(s);
      await sleep(20000);
      const fresh = listDownloads(s).filter((f) => !before.includes(f));
      page = await pageState();
      const pngs = fresh.filter((f) => f.endsWith('.png')).map((f) => checkLongPage(decodePng(readFileSync(join(s.dl, f))), s.dpr, 0).filter((p) => !p.startsWith('width')));
      record('Overlapping capture requests on one tab', null,
        fresh.length === 1 && pngs.length === 1 && !pngs[0].length && page.y === 0 && page.header === 'visible' && page.leftover === 'undefined',
        `downloads=${JSON.stringify(fresh)} png problems=${JSON.stringify(pngs)} | page after: scrollY=${page.y} header=${page.header} state=${page.leftover} | second popup: ${short(secondStatus)}`);
      await backToPage(s);
    } finally { await quit(s); }
  },

  /** Pages extensions cannot capture must fail fast with a clear message. */
  async restricted(base) {
    const s = await launch();
    const clear = (out) => out.kind === 'error' && !/Missing host permission|Missing activeTab/i.test(out.status ?? '');
    try {
      for (const url of ['about:preferences', 'about:blank']) {
        await gotoPage(s, url);
        const before = listDownloads(s);
        const o = await openPopup(s);
        if (!o.buttons) { record(`Restricted ${url}`, null, false, 'popup did not open'); continue; }
        await clickPopup(s, 'png');
        const out = await waitOutcome(s, before, { timeout: 15000 });
        record(`Restricted ${url} → clear message`, null, clear(out), `${out.kind}: ${short(out.status)}`);
        await backToPage(s);
      }
      // A local file: either captured completely or refused clearly.
      {
        await gotoPage(s, `file://${join(ROOT, 'test/fixtures/long-page.html')}`);
        const before = listDownloads(s);
        await openPopup(s);
        await clickPopup(s, 'png');
        const out = await waitOutcome(s, before, { ext: '.png', timeout: 60000 });
        let detail = `${out.kind}: ${short(out.status)}`;
        let ok = clear(out);
        if (out.kind === 'download') {
          const problems = checkLongPage(decodePng(readFileSync(out.path)), s.dpr, await viewportCssWidth(s));
          ok = !problems.length;
          detail = `captured ${problems.join('; ') || 'complete'}`;
        }
        record('Local file (file://) → complete capture or clear message', null, ok, detail);
        await backToPage(s);
      }

      // The extension's own editor page, active after "Capture full page".
      await gotoPage(s, `${base}/long.html`);
      await exportViaEditor(s, 'png');
      await closePopup(s);
      const editorActive = await s.m.chrome(`return gBrowser.selectedBrowser.currentURI.spec.includes('/src/editor/');`);
      const before = listDownloads(s);
      await openPopup(s);
      await clickPopup(s, 'png');
      const out = await waitOutcome(s, before, { timeout: 15000 });
      record('Extension page (editor tab) → clear message', null, editorActive && clear(out), `${out.kind}: ${short(out.status)}`);
    } finally { await quit(s); }
  },
};

/* ------------------------------ main ------------------------------ */

async function main() {
  if (!FIREFOX_BIN || !existsSync(FIREFOX_BIN)) {
    console.error('Set FIREFOX_BIN to a Firefox 140+ binary.');
    process.exit(2);
  }
  if (!existsSync(join(EXT, 'manifest.json'))) {
    console.error(`Missing ${EXT}/manifest.json. Build it first: npm run build:firefox`);
    process.exit(2);
  }
  editorBaseline = readEditorBaseline();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  let exitCode = 1;
  try {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
      if (ONLY && !ONLY.has(name)) continue;
      console.log(`\n=== ${name}`);
      try {
        await fn(base);
      } catch (err) {
        record(name, null, false, `harness error: ${err.stack || err}`);
      }
    }
    exitCode = results.every((r) => r.ok) ? 0 : 1;
  } finally {
    server.close();
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} checks passed  (details: ${join(OUT, 'results.json')})`);
  }
  process.exit(exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

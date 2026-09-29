/**
 * Background (Chrome service worker / Firefox event page): orchestrates a capture.
 *
 * One pipeline serves every popup button and keyboard shortcut:
 *   target tab (from the popup) → check access → capture →
 *   encode PNG / JPEG / PDF and download it, or store it and open the editor.
 *
 * What "capture" means depends on the scope:
 * - full: scroll + captureVisibleTab per tile, then stitch one canvas.
 * - visible: one captureVisibleTab, cropped to the viewport (no scrollbar).
 * - area: an overlay lets the person drag a rectangle; when they finish, the page sends
 *   AREA_SELECTED and one captureVisibleTab is cropped to that rectangle. The two steps are
 *   separate messages, so nothing waits in memory while the person selects (a suspended service
 *   worker or event page loses no state).
 *
 * Access comes from activeTab, which the browser grants when the user clicks the toolbar button,
 * for the document the tab shows at that moment. Firefox drops it as soon as that document is
 * replaced (reload, navigation), so the capture checks access up front and names the cause
 * instead of surfacing the browser's raw "Missing host permission for the tab".
 *
 * The page-side work is done with executeScript({ func }) rather than a declared content script, so
 * the extension stays inert until the user actually triggers a capture.
 */
import { prepAndMeasure, scrollToStep, cleanupPage, measureViewport, startAreaSelection } from '@/lib/pageScripts';
import { stitchTiles, cropViewport, type StitchResult } from '@/lib/stitch';
import { buildPdf } from '@/lib/exportPdf';
import { putCapture } from '@/lib/db';
import { buildFilename } from '@/lib/filename';
import { downloadBlob } from '@/lib/download';
import { loadOptions } from '@/lib/options';
import type {
  AreaSelectedMessage,
  CaptureEvent,
  CaptureMode,
  CaptureScope,
  CaptureTile,
  PageMetrics,
  StartCaptureMessage,
  StartCaptureResponse,
  ViewportMetrics,
  ViewportRect,
} from '@/lib/types';

/** Build-time flag (see vite.config.ts). Only the E2E build sets it; production strips the branch. */
declare const __FULLSHOT_TEST__: boolean;

const MIN_CAPTURE_INTERVAL_MS = 550; // Chrome: stay under MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
const SETTLE_DELAY_MS = 250; // let scroll-triggered layout/lazy content settle
const MAX_CAPTURE_RETRIES = 4;

type Stage = 'target' | 'access' | 'prepare' | 'scroll' | 'capture' | 'stitch' | 'encode' | 'save' | 'editor';

/** A failure the user can act on, tagged with the pipeline stage it happened in. */
class CaptureError extends Error {
  constructor(
    readonly stage: Stage,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** What went into a capture, logged if it fails. No page content, only the origin. */
interface Diagnostics {
  mode: CaptureMode;
  scope: CaptureScope;
  tabId: number;
  stage: Stage;
  origin?: string;
  page?: Omit<PageMetrics, 'scrollX' | 'scrollY'> & { startScroll: [number, number] };
  /** Pixels per CSS px actually used for stitching (see tilePixelScale). */
  pixelScale?: number;
  tile?: string;
  scroll?: [number, number];
}

const MSG = {
  busy: 'A capture is already running. Wait for it to finish, then try again.',
  closed: 'The tab to capture was closed.',
  switchBack: 'Switch back to the tab you want to capture, then click the FullShot button again.',
  lostAccess:
    'FullShot no longer has access to this page because it reloaded or navigated after you ' +
    'opened FullShot. Click the FullShot button again.',
  restricted: 'The browser does not let extensions capture this page (built-in, extension and store pages).',
  noAccess:
    'FullShot cannot access this page. If it reloaded or navigated after you opened FullShot, ' +
    'click the FullShot button again. Some pages (browser pages, add-on stores, the PDF viewer) ' +
    'cannot be captured at all.',
  pageChanged:
    'The page reloaded or navigated during the capture. Click the FullShot button again and ' +
    'stay on the page until the capture finishes.',
  tabSwitched: 'Capture stopped because the tab was switched. Stay on the page until the capture finishes.',
};

/** Schemes whose pages extensions can never script or capture, in Chrome or Firefox. */
const RESTRICTED_SCHEME =
  /^(about|chrome|chrome-extension|chrome-search|chrome-untrusted|moz-extension|edge|devtools|view-source|resource|jar|data|blob|javascript):/i;
/** Store / account pages the browsers protect from extensions. */
const RESTRICTED_HOSTS = new Set([
  'chromewebstore.google.com',
  'microsoftedge.microsoft.com',
  'addons.mozilla.org',
  'accounts.firefox.com',
  'support.mozilla.org',
]);

function isRestrictedUrl(url: string): boolean {
  if (RESTRICTED_SCHEME.test(url)) return true;
  try {
    const u = new URL(url);
    return RESTRICTED_HOSTS.has(u.hostname) || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'));
  } catch {
    return false;
  }
}

// Captures scroll the page and keep state on it, so two at once would corrupt both.
let captureRunning = false;

const CAPTURE_MODES: readonly CaptureMode[] = ['edit', 'png', 'jpeg', 'pdf'];
const CAPTURE_SCOPES: readonly CaptureScope[] = ['full', 'visible', 'area'];

/** The area a person selected, plus the viewport it was selected in. */
interface SelectedArea {
  rect: ViewportRect;
  metrics: ViewportMetrics;
}

// Open the welcome page on install.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg: StartCaptureMessage | AreaSelectedMessage, sender, sendResponse) => {
  if (msg?.type === 'AREA_SELECTED') {
    onAreaSelected(msg, sender);
    return undefined;
  }
  if (msg?.type !== 'START_CAPTURE') return undefined;
  if (captureRunning) {
    // Not broadcast: the popup showing the running capture must keep showing its progress.
    sendResponse({ ok: false, error: MSG.busy, stage: 'target' } satisfies StartCaptureResponse);
    return undefined;
  }
  const scope: CaptureScope = CAPTURE_SCOPES.includes(msg.scope as CaptureScope) ? (msg.scope as CaptureScope) : 'full';
  if (scope === 'area') {
    // Step 1 of 2: show the overlay. The popup closes so the person can drag on the page.
    beginAreaSelection(msg.mode, msg.tabId).then(
      () => sendResponse({ ok: true, pending: 'area' } satisfies StartCaptureResponse),
      (err: CaptureError) => sendResponse({ ok: false, error: err.message, stage: err.stage } satisfies StartCaptureResponse),
    );
    return true;
  }
  startCapture(msg.mode, msg.tabId, scope).then(
    () => sendResponse({ ok: true } satisfies StartCaptureResponse),
    (err: CaptureError) => {
      broadcast({ type: 'CAPTURE_ERROR', message: err.message });
      sendResponse({ ok: false, error: err.message, stage: err.stage } satisfies StartCaptureResponse);
    },
  );
  // Keep the channel open and answer with sendResponse(): that works in Chrome and Firefox, while
  // Chrome ignores a promise returned from the listener (verified on Chrome 141: the sender gets no
  // response). Firefox does not suspend the event page mid-capture either way: every extension API
  // call the capture makes resets its idle timer (verified with a 30+ s capture).
  return true;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function broadcast(message: CaptureEvent): void {
  // Best-effort: the popup may already be closed.
  chrome.runtime.sendMessage(message).catch(() => {});
}

function errorText(err: unknown): string {
  let text: string;
  if (err instanceof Error) text = err.message;
  else if (typeof err === 'string') text = err;
  else {
    try {
      text = JSON.stringify(err) ?? String(err);
    } catch {
      text = String(err);
    }
  }
  // Some browser errors echo their arguments (e.g. a multi-megabyte data: URL); keep them short.
  return text.slice(0, 300);
}

/** Map a raw browser error to an actionable message for the stage it happened in. */
function toCaptureError(err: unknown, stage: Stage): CaptureError {
  if (err instanceof CaptureError) return err;
  const text = errorText(err);
  // Firefox: "Missing host permission for the tab" / "Missing activeTab permission".
  // Chrome: "Cannot access contents of …" / "Cannot access a chrome:// URL" / "… cannot be scripted".
  if (/missing host permission|missing activetab permission|cannot access|cannot be scripted/i.test(text)) {
    // On the first injection this is either a page the browser protects or access lost just
    // before; later it means the document changed under the capture.
    return new CaptureError(stage, stage === 'prepare' ? MSG.noAccess : MSG.pageChanged);
  }
  if (/no tab with id|invalid tab id/i.test(text)) return new CaptureError(stage, MSG.closed);
  return new CaptureError(stage, `Capture failed while ${STAGE_LABEL[stage]}: ${text}`);
}

const STAGE_LABEL: Record<Stage, string> = {
  target: 'finding the tab',
  access: 'checking access to the page',
  prepare: 'preparing the page',
  scroll: 'scrolling the page',
  capture: 'capturing the screen',
  stitch: 'combining the screenshots',
  encode: 'creating the file',
  save: 'saving the file',
  editor: 'opening the editor',
};

/**
 * Keyboard shortcuts for the visible and area captures. Both open the editor. activeTab is
 * granted for the shortcut's tab, as for a toolbar click.
 */
const COMMAND_SCOPES: Record<string, CaptureScope> = {
  'capture-visible': 'visible',
  'capture-area': 'area',
};

chrome.commands.onCommand.addListener((command, tab) => {
  const scope = COMMAND_SCOPES[command];
  if (scope) void runShortcut(scope, tab);
});

async function runShortcut(scope: CaptureScope, tab?: chrome.tabs.Tab): Promise<void> {
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0]?.id;
  if (tabId === undefined) return;
  if (captureRunning) {
    flagError(tabId, MSG.busy);
    return;
  }
  try {
    if (scope === 'area') await beginAreaSelection('edit', tabId);
    else await startCapture('edit', tabId, scope);
  } catch (err) {
    flagError(tabId, err instanceof Error ? err.message : errorText(err));
  }
}

/**
 * With no popup open (keyboard shortcut, area selection), show a failure on the toolbar button:
 * a "!" badge, with the message in the button's tooltip. The next capture clears it.
 */
function flagError(tabId: number, message: string): void {
  chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId }).catch(() => {});
  chrome.action.setBadgeText({ text: '!', tabId }).catch(() => {});
  chrome.action.setTitle({ title: `FullShot: ${message}`, tabId }).catch(() => {});
}

function clearFlag(tabId: number): void {
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  const title = chrome.runtime.getManifest().action?.default_title ?? 'FullShot';
  chrome.action.setTitle({ title, tabId }).catch(() => {});
}

/** Area capture, step 1: check access, then show the selection overlay on the page. */
async function beginAreaSelection(mode: CaptureMode, tabId: number): Promise<void> {
  const diag: Diagnostics = { mode, scope: 'area', tabId, stage: 'target' };
  clearFlag(tabId);
  try {
    await resolveTarget(tabId, diag);
    diag.stage = 'prepare';
    await inject(tabId, startAreaSelection, [mode]);
  } catch (err) {
    const error = toCaptureError(err, diag.stage);
    console.error('[FullShot] area selection failed', {
      ...diag,
      error: { name: err instanceof Error ? err.name : typeof err, message: errorText(err) },
    });
    throw error;
  }
}

/** Area capture, step 2: the overlay reports the rectangle (or null when cancelled). */
function onAreaSelected(msg: AreaSelectedMessage, sender: chrome.runtime.MessageSender): void {
  const tabId = sender.tab?.id;
  // Only this extension's overlay can send the message: web pages cannot message the extension.
  if (tabId === undefined || sender.id !== chrome.runtime.id || !msg.rect) return;
  if (!CAPTURE_MODES.includes(msg.mode) || !isUsableArea(msg.rect, msg.metrics)) return;
  if (captureRunning) {
    flagError(tabId, MSG.busy);
    return;
  }
  startCapture(msg.mode, tabId, 'area', { rect: msg.rect, metrics: msg.metrics }).catch((err: CaptureError) => {
    broadcast({ type: 'CAPTURE_ERROR', message: err.message });
    flagError(tabId, err.message);
  });
}

function isUsableArea(rect: ViewportRect, metrics: ViewportMetrics): boolean {
  const numbers = [rect.x, rect.y, rect.width, rect.height, metrics.innerWidth, metrics.devicePixelRatio];
  return numbers.every((n) => typeof n === 'number' && Number.isFinite(n)) && rect.width >= 1 && rect.height >= 1;
}

async function startCapture(mode: CaptureMode, tabId: number, scope: CaptureScope = 'full', area?: SelectedArea): Promise<void> {
  captureRunning = true; // set synchronously, before the first await
  const diag: Diagnostics = { mode, scope, tabId, stage: 'target' };
  clearFlag(tabId);
  try {
    await runCapture(mode, tabId, scope, diag, area);
  } catch (err) {
    const error = toCaptureError(err, diag.stage);
    console.error('[FullShot] capture failed', {
      ...diag,
      error: { name: err instanceof Error ? err.name : typeof err, message: errorText(err) },
    });
    throw error;
  } finally {
    captureRunning = false;
  }
}

/**
 * Confirm the tab can be captured right now. `tab.url` is only visible to the extension while
 * activeTab is valid for the tab's current document, so a missing URL means access was lost.
 */
async function resolveTarget(tabId: number, diag: Diagnostics): Promise<chrome.tabs.Tab & { id: number; url: string }> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new CaptureError('target', MSG.closed);
  }
  // captureVisibleTab can only capture the tab that is showing in its window.
  if (!tab.active) throw new CaptureError('target', MSG.switchBack);
  diag.stage = 'access';
  const url = tab.url ?? '';
  if (url && isRestrictedUrl(url)) throw new CaptureError('access', MSG.restricted);
  if (!url) throw new CaptureError('access', MSG.lostAccess);
  try {
    diag.origin = new URL(url).origin;
  } catch {
    /* leave unset */
  }
  return tab as chrome.tabs.Tab & { id: number; url: string };
}

/** Stop if the target tab is no longer the one showing in its window. */
async function assertStillShowing(tabId: number, windowId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab) throw new CaptureError('capture', MSG.closed);
  if (!tab.active || tab.windowId !== windowId) throw new CaptureError('capture', MSG.tabSwitched);
}

function computeAxis(full: number, viewport: number): number[] {
  const max = Math.max(0, full - viewport);
  const steps: number[] = [];
  for (let p = 0; p < max; p += viewport) steps.push(p);
  steps.push(max);
  return steps;
}

async function captureVisible(windowId: number): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_CAPTURE_RETRIES; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (err) {
      lastErr = err;
      await sleep(MIN_CAPTURE_INTERVAL_MS + 150 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('captureVisibleTab failed');
}

async function inject<Args extends unknown[], R>(
  tabId: number,
  func: (...args: Args) => R,
  args: Args,
): Promise<R> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: func as (...a: unknown[]) => unknown,
    args,
  });
  // Firefox reports an exception thrown by the injected function in `error` instead of rejecting.
  const error = (res as { error?: unknown } | undefined)?.error;
  if (!res || error !== undefined) throw new Error(`Page script failed: ${errorText(error ?? 'no result')}`);
  return res.result as R;
}

/** Scroll through the page and capture every viewport-sized tile. Always restores the page. */
async function captureTiles(
  tab: chrome.tabs.Tab & { id: number },
  diag: Diagnostics,
): Promise<{ tiles: CaptureTile[]; metrics: PageMetrics }> {
  const tabId = tab.id;
  const windowId = tab.windowId;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  diag.stage = 'prepare';
  const metrics = await inject(tabId, prepAndMeasure, [token]);
  const { scrollX, scrollY, ...page } = metrics;
  diag.page = { ...page, startScroll: [scrollX, scrollY] };

  const xs = computeAxis(metrics.fullWidth, metrics.viewportWidth);
  const ys = computeAxis(metrics.fullHeight, metrics.viewportHeight);
  const total = xs.length * ys.length;

  const tiles: CaptureTile[] = [];
  let lastCaptureAt = 0;
  try {
    for (const y of ys) {
      for (const x of xs) {
        diag.stage = 'scroll';
        diag.tile = `${tiles.length + 1}/${total}`;
        const pos = await inject(tabId, scrollToStep, [token, x, y]);
        if (!pos.ok) throw new CaptureError('scroll', MSG.pageChanged);
        diag.scroll = [pos.x, pos.y];
        await sleep(SETTLE_DELAY_MS);

        const wait = MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
        if (wait > 0) await sleep(wait);

        // captureVisibleTab captures whatever tab is showing in the window, so check it is still
        // ours before and after (a switch during the call could return the other tab).
        diag.stage = 'capture';
        await assertStillShowing(tabId, windowId);
        const dataUrl = await captureVisible(windowId);
        lastCaptureAt = Date.now();
        await assertStillShowing(tabId, windowId);
        tiles.push({ dataUrl, x: pos.x, y: pos.y });

        broadcast({ type: 'CAPTURE_PROGRESS', done: tiles.length, total });
      }
    }
  } finally {
    await inject(tabId, cleanupPage, [token]).catch(() => {});
  }
  return { tiles, metrics };
}

async function runCapture(
  mode: CaptureMode,
  tabId: number,
  scope: CaptureScope,
  diag: Diagnostics,
  area?: SelectedArea,
): Promise<void> {
  const tab = await resolveTarget(tabId, diag);
  const capturedAt = Date.now();
  // JPEG and PDF have no alpha channel: give them a white page instead of black gaps.
  const background = mode === 'jpeg' || mode === 'pdf' ? '#ffffff' : undefined;

  let image: StitchResult;
  if (scope === 'full') {
    const { tiles, metrics } = await captureTiles(tab, diag);
    broadcast({ type: 'CAPTURE_DONE' });
    diag.stage = 'stitch';
    image = await stitchTiles(tiles, metrics, { background });
    tiles.length = 0; // release the tile data URLs before encoding
  } else {
    image = await captureViewportArea(tab, diag, area, background);
  }
  diag.pixelScale = image.pixelScale;
  await finishCapture(image, mode, tab, capturedAt, diag);
}

/**
 * Visible-area and area captures: one captureVisibleTab, cropped. The page is not changed, so
 * the image shows exactly what the person sees (fixed and sticky elements included).
 */
async function captureViewportArea(
  tab: chrome.tabs.Tab & { id: number },
  diag: Diagnostics,
  area: SelectedArea | undefined,
  background: string | undefined,
): Promise<StitchResult> {
  diag.stage = 'prepare';
  const metrics = area?.metrics ?? (await inject(tab.id, measureViewport, []));
  const rect = area?.rect ?? { x: 0, y: 0, width: metrics.viewportWidth, height: metrics.viewportHeight };

  diag.stage = 'capture';
  await assertStillShowing(tab.id, tab.windowId);
  const dataUrl = await captureVisible(tab.windowId);
  await assertStillShowing(tab.id, tab.windowId);
  broadcast({ type: 'CAPTURE_DONE' });

  diag.stage = 'stitch';
  return cropViewport(dataUrl, metrics, rect, { background });
}

/** Encode the image and download it, or store it and open the editor. */
async function finishCapture(
  image: StitchResult,
  mode: CaptureMode,
  tab: chrome.tabs.Tab & { id: number; url: string },
  capturedAt: number,
  diag: Diagnostics,
): Promise<void> {
  const options = await loadOptions();

  diag.stage = 'encode';
  const ext = mode === 'jpeg' ? 'jpg' : mode === 'edit' ? 'png' : mode;
  let blob: Blob;
  if (mode === 'pdf') {
    blob = await buildPdf(image.canvas, {
      pageUrl: tab.url,
      capturedAt,
      quality: options.jpegQuality,
      stamp: options.stampUrlAndDate,
    });
  } else {
    blob = await image.canvas.convertToBlob(
      mode === 'jpeg' ? { type: 'image/jpeg', quality: options.jpegQuality } : { type: 'image/png' },
    );
  }

  if (mode !== 'edit') {
    diag.stage = 'save';
    await downloadBlob(blob, buildFilename(tab.url, capturedAt, ext));
    return;
  }

  diag.stage = 'editor';
  const id = `cap_${capturedAt}_${Math.random().toString(36).slice(2, 8)}`;
  await putCapture({
    id,
    blob,
    width: image.width,
    height: image.height,
    pageUrl: tab.url,
    pageTitle: tab.title ?? '',
    capturedAt,
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/editor/index.html?id=${id}`) });
}

// E2E-only: lets the test harness kick off a real capture without a toolbar gesture.
// For scope 'area' it resolves once the overlay shows; the capture runs when the selection ends.
if (__FULLSHOT_TEST__) {
  (self as unknown as { __fullshotTest?: (mode: CaptureMode, scope?: CaptureScope) => Promise<void> }).__fullshotTest =
    async (mode, scope = 'full') => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error('No active tab.');
      if (captureRunning) throw new Error(MSG.busy);
      if (scope === 'area') await beginAreaSelection(mode, tab.id);
      else await startCapture(mode, tab.id, scope);
    };
}

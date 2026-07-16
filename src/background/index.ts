/**
 * Service worker: orchestrates a full-page capture.
 *
 * Flow: measure the page → scroll it in viewport steps, snapshotting each with
 * chrome.tabs.captureVisibleTab (throttled to Chrome's ~2/sec quota) → stitch the tiles into one
 * image with OffscreenCanvas → hand off to the editor (via IndexedDB) or download directly.
 *
 * The page-side work is done with executeScript({ func }) rather than a declared content script, so
 * the extension stays inert (activeTab model) until the user actually triggers a capture.
 */
import { prepAndMeasure, scrollToStep, cleanupPage } from '@/lib/pageScripts';
import { stitchTiles } from '@/lib/stitch';
import { putCapture } from '@/lib/db';
import { buildFilename } from '@/lib/filename';
import { blobToDataUrl } from '@/lib/blob';
import { loadOptions } from '@/lib/options';
import type { CaptureTile, PageMetrics } from '@/lib/types';

/** Build-time flag (see vite.config.ts). Only the E2E build sets it; production strips the branch. */
declare const __FULLSHOT_TEST__: boolean;

const MIN_CAPTURE_INTERVAL_MS = 550; // stay under MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
const SETTLE_DELAY_MS = 250; // let scroll-triggered layout/lazy content settle
const MAX_CAPTURE_RETRIES = 4;

type CaptureMode = 'edit' | 'png' | 'jpeg' | 'pdf';
interface StartCaptureMsg {
  type: 'START_CAPTURE';
  mode: CaptureMode;
}

// Open the welcome page on install.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg: StartCaptureMsg, _sender, sendResponse) => {
  if (msg?.type === 'START_CAPTURE') {
    runCapture(msg.mode)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        broadcast({ type: 'CAPTURE_ERROR', message });
        sendResponse({ ok: false, error: message });
      });
    return true; // keep the message channel open for the async response
  }
  return undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function broadcast(message: unknown): void {
  // Best-effort: the popup may already be closed.
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab to capture.');
  const url = tab.url ?? '';
  if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(url) || url.startsWith('https://chromewebstore.google.com')) {
    throw new Error('This page cannot be captured by extensions.');
  }
  return tab;
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
  return res.result as R;
}

async function runCapture(mode: CaptureMode): Promise<void> {
  const tab = await getActiveTab();
  const tabId = tab.id!;
  const windowId = tab.windowId;

  const metrics = await inject<[], PageMetrics>(tabId, prepAndMeasure, []);

  const xs = computeAxis(metrics.fullWidth, metrics.viewportWidth);
  const ys = computeAxis(metrics.fullHeight, metrics.viewportHeight);
  const total = xs.length * ys.length;

  const tiles: CaptureTile[] = [];
  let lastCaptureAt = 0;
  let done = 0;

  try {
    for (const y of ys) {
      for (const x of xs) {
        const actual = await inject<[number, number], { x: number; y: number }>(
          tabId,
          scrollToStep,
          [x, y],
        );
        await sleep(SETTLE_DELAY_MS);

        const wait = MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
        if (wait > 0) await sleep(wait);

        const dataUrl = await captureVisible(windowId);
        lastCaptureAt = Date.now();
        tiles.push({ dataUrl, x: actual.x, y: actual.y });

        done++;
        broadcast({ type: 'CAPTURE_PROGRESS', done, total });
      }
    }
  } finally {
    await inject(tabId, cleanupPage, []).catch(() => {});
  }

  // Quick JPEG can be encoded straight from the stitch canvas; everything else stitches to PNG.
  const options = await loadOptions();
  const encodeType = mode === 'jpeg' ? 'image/jpeg' : 'image/png';
  const stitched = await stitchTiles(tiles, metrics, {
    type: encodeType,
    quality: mode === 'jpeg' ? options.jpegQuality : undefined,
  });

  const id = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await putCapture({
    id,
    blob: stitched.blob,
    width: stitched.width,
    height: stitched.height,
    pageUrl: tab.url ?? '',
    pageTitle: tab.title ?? '',
    capturedAt: Date.now(),
  });

  broadcast({ type: 'CAPTURE_DONE' });

  if (mode === 'png' || mode === 'jpeg') {
    const ext = mode === 'jpeg' ? 'jpg' : 'png';
    const dataUrl = await blobToDataUrl(stitched.blob);
    await chrome.downloads.download({
      url: dataUrl,
      filename: buildFilename(tab.url ?? '', Date.now(), ext),
      saveAs: false,
    });
  } else {
    // 'edit' and 'pdf' open the editor; 'pdf' asks it to auto-run PDF export on load.
    const auto = mode === 'pdf' ? '&auto=pdf' : '';
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`src/editor/index.html?id=${id}${auto}`),
    });
  }
}

// E2E-only: lets the test harness kick off a real capture without a toolbar gesture.
if (__FULLSHOT_TEST__) {
  (self as unknown as { __fullshotTest?: (mode: CaptureMode) => Promise<void> }).__fullshotTest =
    runCapture;
}

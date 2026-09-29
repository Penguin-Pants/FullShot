/**
 * Functions injected into the target page with chrome.scripting.executeScript({ func }).
 *
 * IMPORTANT: each function runs in the page's isolated world and is serialized via
 * Function.prototype.toString, so it must be fully self-contained — no references to imports,
 * module-scope variables, or TypeScript helpers. State that must survive across injected calls is
 * stashed on `window.__fullshot__` (the isolated world persists for the document between calls).
 *
 * Every call carries the capture's token. A mismatch means the document was replaced (reload,
 * navigation) or another capture took over, and the caller aborts instead of stitching tiles from
 * the wrong page. The functions report problems in their return value rather than by throwing,
 * because Firefox and Chrome surface exceptions from injected functions differently.
 */
import type { CaptureMode, PageMetrics, ViewportMetrics } from './types';

interface FullShotPageState {
  token: string;
  originalScrollX: number;
  originalScrollY: number;
  originalScrollbarWidth: [value: string, priority: string];
  fixed: Array<{ el: HTMLElement; visibility: string }>;
}

declare global {
  interface Window {
    __fullshot__?: FullShotPageState;
    /** The open area-selection overlay, if any (see startAreaSelection). */
    __fullshotArea__?: { destroy: () => void };
  }
}

/**
 * Hide scrollbars, measure the page, and record fixed/sticky elements. Runs once per capture.
 *
 * Scrollbars are hidden before measuring so the layout stays the same for every tile: overlay
 * scrollbars (GTK, macOS) take no layout space and would otherwise be painted into every tile.
 */
export function prepAndMeasure(token: string): PageMetrics {
  const de = document.documentElement;

  // An area selection that is still open would show in the tiles. The first tile is taken after
  // a scroll and a settle delay, so the page is painted without the overlay by then.
  window.__fullshotArea__?.destroy();

  // A previous capture that never cleaned up (e.g. the extension was reloaded mid-capture) left
  // elements hidden. Restore them before recording the "original" state again.
  const stale = window.__fullshot__;
  if (stale) {
    for (const item of stale.fixed) item.el.style.visibility = item.visibility;
    de.style.setProperty('scrollbar-width', ...stale.originalScrollbarWidth);
    window.scrollTo({ left: stale.originalScrollX, top: stale.originalScrollY, behavior: 'instant' });
    delete window.__fullshot__;
  }

  const originalScrollbarWidth: [string, string] = [
    de.style.getPropertyValue('scrollbar-width'),
    de.style.getPropertyPriority('scrollbar-width'),
  ];
  // Inline !important also beats a page stylesheet's !important rule.
  de.style.setProperty('scrollbar-width', 'none', 'important');

  // The scrolling element is <html> in standards mode but <body> in quirks mode, where
  // documentElement.clientHeight is the height of the whole document instead of the viewport.
  // Its client size is the viewport minus any classic scrollbar in both modes.
  const se = (document.scrollingElement as HTMLElement | null) ?? de;
  const body = document.body;
  const viewportWidth = se.clientWidth;
  const viewportHeight = se.clientHeight;
  const fullWidth = Math.max(se.scrollWidth, de.scrollWidth, body ? body.scrollWidth : 0, viewportWidth);
  const fullHeight = Math.max(se.scrollHeight, de.scrollHeight, body ? body.scrollHeight : 0, viewportHeight);

  const fixed: Array<{ el: HTMLElement; visibility: string }> = [];
  const all = body ? body.getElementsByTagName('*') : [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement;
    const pos = window.getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      fixed.push({ el, visibility: el.style.visibility });
    }
  }

  window.__fullshot__ = {
    token,
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
    originalScrollbarWidth,
    fixed,
  };

  return {
    fullWidth,
    fullHeight,
    viewportWidth,
    viewportHeight,
    // Includes any classic scrollbar, i.e. the CSS size of what captureVisibleTab returns.
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

/**
 * Scroll to (x, y) and return the actual (clamped) position. Fixed/sticky elements are hidden for
 * every row except the top one, so a sticky header is captured once instead of on every tile.
 */
export function scrollToStep(
  token: string,
  x: number,
  y: number,
): { ok: true; x: number; y: number } | { ok: false } {
  const state = window.__fullshot__;
  if (!state || state.token !== token) return { ok: false };
  const hideFixed = y > 0;
  for (const item of state.fixed) {
    item.el.style.visibility = hideFixed ? 'hidden' : item.visibility;
  }
  // 'instant' ignores any scroll-behavior the page sets (even with !important), so the position
  // read back below is the final one rather than a point partway through a smooth scroll.
  window.scrollTo({ left: x, top: y, behavior: 'instant' });
  return { ok: true, x: window.scrollX, y: window.scrollY };
}

/** Restore the page to its pre-capture state. Only the capture that prepared the page may do it. */
export function cleanupPage(token: string): boolean {
  const state = window.__fullshot__;
  if (!state || state.token !== token) return false;
  const de = document.documentElement;
  for (const item of state.fixed) {
    item.el.style.visibility = item.visibility;
  }
  de.style.setProperty('scrollbar-width', ...state.originalScrollbarWidth);
  window.scrollTo({ left: state.originalScrollX, top: state.originalScrollY, behavior: 'instant' });
  delete window.__fullshot__;
  return true;
}

/**
 * Measure the viewport for a visible-area capture. Changes nothing on the page: the capture
 * shows the page exactly as the person sees it, fixed and sticky elements included. Only an
 * area-selection overlay that is still open is removed, because it would show in the capture.
 */
export async function measureViewport(): Promise<ViewportMetrics> {
  if (window.__fullshotArea__) {
    window.__fullshotArea__.destroy();
    // Wait until the page is painted without the overlay (the timer covers a paused rendering).
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      setTimeout(resolve, 250);
    });
  }
  const se = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  // A classic scrollbar on the left (Firefox with a right-to-left browser UI) moves the viewport
  // to the right in the captured image. Firefox reports that scrollbar in the scrolling element's
  // clientLeft. Chrome keeps the page scrollbar on the right; there clientLeft is only the
  // element's left border, which is part of the page. startAreaSelection() does the same.
  const border = parseFloat(getComputedStyle(se).borderLeftWidth) || 0;
  const scrollbar = Math.max(0, window.innerWidth - se.clientWidth);
  return {
    viewportWidth: se.clientWidth,
    viewportHeight: se.clientHeight,
    viewportLeft: Math.abs(se.clientLeft - border) >= 1 ? Math.min(se.clientLeft, scrollbar) : 0,
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

/**
 * Show a full-viewport overlay where the person drags a rectangle. When done (or cancelled with
 * Escape) the overlay removes itself, waits until the page is painted without it, and sends an
 * AREA_SELECTED message to the background, which then captures and crops the viewport.
 *
 * The overlay is a modal <dialog> in a closed shadow root: page styles cannot change it, page
 * scripts cannot reach it, and it is in the top layer, above the page's own modal dialogs,
 * popovers and fullscreen elements. It takes the keyboard focus, so Enter and Esc work even when
 * the focus was in a frame, and gives the focus back when it closes. The pointer and key events
 * it uses do not reach the page. Enter selects the whole visible area. A second call replaces
 * the first overlay; a full-page or visible capture removes it (see prepAndMeasure and
 * measureViewport).
 */
export function startAreaSelection(mode: CaptureMode): boolean {
  type Rect = { x: number; y: number; width: number; height: number };
  window.__fullshotArea__?.destroy();

  const MIN_SIZE = 5;
  const host = document.createElement('div');
  // Page rules cannot hide the host (the dialog renders only if the host does). The position is
  // for the fallback below, where the dialog is not in the top layer.
  for (const [name, value] of [['all', 'initial'], ['display', 'block'], ['position', 'fixed'], ['inset', '0'], ['z-index', '2147483647']]) {
    host.style.setProperty(name, value, 'important');
  }
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    dialog { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none;
             margin: 0; padding: 0; border: 0; background: transparent; overflow: hidden; outline: none; }
    dialog::backdrop { background: transparent; }
    .layer { position: fixed; inset: 0; cursor: crosshair; background: rgba(15, 23, 42, 0.45); }
    .layer.selecting { background: transparent; }
    .box { position: fixed; display: none; box-sizing: border-box; border: 2px solid #14b8a6;
           box-shadow: 0 0 0 100vmax rgba(15, 23, 42, 0.45); pointer-events: none; }
    .label, .hint { position: fixed; font: 600 13px/1.3 -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
                    color: #e2e8f0; background: #0f172a; border-radius: 6px; padding: 4px 8px; pointer-events: none; }
    .label { display: none; }
    .hint { top: 16px; left: 50%; transform: translateX(-50%); padding: 10px 16px; text-align: center;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
    .hint small { display: block; font-weight: 400; color: #94a3b8; }
  `;
  const dialog = document.createElement('dialog');
  dialog.tabIndex = -1;
  const layer = document.createElement('div');
  layer.className = 'layer';
  const box = document.createElement('div');
  box.className = 'box';
  const label = document.createElement('div');
  label.className = 'label';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'FullShot: drag to select an area';
  const keys = document.createElement('small');
  keys.textContent = 'Enter: visible area \u00b7 Esc: cancel';
  hint.append(keys);
  dialog.append(layer, box, label, hint);
  root.append(style, dialog);
  document.documentElement.appendChild(host);

  const se = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  const previousFocus = document.activeElement as HTMLElement | null;
  let start: { x: number; y: number } | null = null;
  let state: 'selecting' | 'closing' | 'closed' = 'selecting';
  let result: Rect | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let keyToSwallow = '';

  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => {
    // Keep the selection inside the viewport (not over a classic scrollbar).
    const clampX = (v: number) => Math.min(Math.max(v, 0), se.clientWidth);
    const clampY = (v: number) => Math.min(Math.max(v, 0), se.clientHeight);
    const x1 = clampX(Math.min(a.x, b.x));
    const y1 = clampY(Math.min(a.y, b.y));
    const x2 = clampX(Math.max(a.x, b.x));
    const y2 = clampY(Math.max(a.y, b.y));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  };

  // Choose the result. The overlay stays until the click that follows a drag, or the key-up that
  // follows Enter or Esc, has come: the overlay swallows it, so the page does not get it.
  function select(rect: Rect | null, waitMs: number): void {
    if (state !== 'selecting') return;
    state = 'closing';
    result = rect;
    closeTimer = setTimeout(report, waitMs);
  }

  // Remove the overlay, wait until the page is painted without it, then send the result.
  function report(): void {
    if (state !== 'closing') return;
    destroy();
    // As in measureViewport: the viewport starts after a classic scrollbar on the left.
    const border = parseFloat(getComputedStyle(se).borderLeftWidth) || 0;
    const scrollbar = Math.max(0, window.innerWidth - se.clientWidth);
    const metrics = {
      viewportWidth: se.clientWidth,
      viewportHeight: se.clientHeight,
      viewportLeft: Math.abs(se.clientLeft - border) >= 1 ? Math.min(se.clientLeft, scrollbar) : 0,
      innerWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        chrome.runtime.sendMessage({ type: 'AREA_SELECTED', mode, rect: result, metrics }).catch(() => {});
      }),
    );
  }

  // Remove the overlay without a result (also when another capture starts).
  function destroy(): void {
    if (state === 'closed') return;
    state = 'closed';
    clearTimeout(closeTimer);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKey, true);
    if (dialog.open) dialog.close(); // gives the focus back to where it was
    host.remove();
    // Chrome's dialog does not give the focus back to a frame: do it here. (Chrome clears the
    // focus inside the frame when the focus leaves it, so the frame gets it, not its field.)
    if (previousFocus && previousFocus !== document.activeElement && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
      previousFocus.focus({ preventScroll: true });
    }
    if (window.__fullshotArea__ === handle) delete window.__fullshotArea__;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' && event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'keyup') {
      if (event.key === keyToSwallow) report();
      return;
    }
    if (state !== 'selecting') return;
    keyToSwallow = event.key;
    // No key-up comes when the key is held down: close after a second anyway.
    select(event.key === 'Enter' ? { x: 0, y: 0, width: se.clientWidth, height: se.clientHeight } : null, 1000);
  }

  // Page handlers (a drag, a click outside a menu) must not see the overlay's events: they
  // could change the page just before the capture. The events stop at the dialog.
  const stop = (event: Event) => event.stopPropagation();
  for (const type of [
    'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout',
    'gotpointercapture', 'lostpointercapture', 'mousedown', 'mousemove', 'mouseup', 'mouseover', 'mouseout',
    'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
  ]) {
    dialog.addEventListener(type, stop, { passive: true });
  }
  // Esc can also reach the dialog as a close request.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    select(null, 0);
  });
  dialog.addEventListener('close', () => select(null, 0));

  layer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || state !== 'selecting') return;
    event.preventDefault();
    layer.setPointerCapture(event.pointerId);
    start = { x: event.clientX, y: event.clientY };
    layer.classList.add('selecting');
    hint.style.display = 'none';
  });
  layer.addEventListener('pointermove', (event) => {
    if (!start) return;
    const r = rectFrom(start, { x: event.clientX, y: event.clientY });
    Object.assign(box.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    label.textContent = `${Math.round(r.width)} \u00d7 ${Math.round(r.height)}`;
    Object.assign(label.style, { display: 'block', left: `${r.x}px`, top: `${r.y > 30 ? r.y - 28 : r.y + r.height + 6}px` });
  });
  layer.addEventListener('pointerup', (event) => {
    if (!start) return;
    const r = rectFrom(start, { x: event.clientX, y: event.clientY });
    start = null;
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) {
      // A click, not a drag: start again.
      box.style.display = 'none';
      label.style.display = 'none';
      layer.classList.remove('selecting');
      hint.style.display = '';
      return;
    }
    select(r, 0);
  });
  layer.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKey, true);

  const handle = { destroy };
  window.__fullshotArea__ = handle;
  try {
    dialog.showModal();
  } catch {
    dialog.show(); // not in the top layer, but the host keeps the overlay above the page
  }
  dialog.focus({ preventScroll: true });
  return true;
}

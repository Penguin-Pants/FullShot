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
 * Measure the viewport for a visible-area or area capture. Changes nothing on the page: these
 * captures show the page exactly as the person sees it, fixed and sticky elements included.
 */
export function measureViewport(): ViewportMetrics {
  const se = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  return {
    viewportWidth: se.clientWidth,
    viewportHeight: se.clientHeight,
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

/**
 * Show a full-viewport overlay where the person drags a rectangle. When done (or cancelled with
 * Escape) the overlay removes itself, waits until the page is painted without it, and sends an
 * AREA_SELECTED message to the background, which then captures and crops the viewport.
 *
 * The overlay lives in a closed shadow root, so page styles cannot change it and page scripts
 * cannot reach it. Enter selects the whole visible area. A second call replaces the first overlay.
 */
export function startAreaSelection(mode: CaptureMode): boolean {
  type OverlayHandle = { destroy: () => void };
  const w = window as unknown as { __fullshotArea__?: OverlayHandle };
  w.__fullshotArea__?.destroy();

  const MIN_SIZE = 5;
  const host = document.createElement('div');
  host.setAttribute('style', 'all: initial; position: fixed; inset: 0; z-index: 2147483647;');
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
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
  root.append(style, layer, box, label, hint);
  document.documentElement.appendChild(host);

  const se = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  let start: { x: number; y: number } | null = null;
  let done = false;

  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    // Keep the selection inside the viewport (not over a classic scrollbar).
    const clampX = (v: number) => Math.min(Math.max(v, 0), se.clientWidth);
    const clampY = (v: number) => Math.min(Math.max(v, 0), se.clientHeight);
    const x1 = clampX(Math.min(a.x, b.x));
    const y1 = clampY(Math.min(a.y, b.y));
    const x2 = clampX(Math.max(a.x, b.x));
    const y2 = clampY(Math.max(a.y, b.y));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      finish({ x: 0, y: 0, width: se.clientWidth, height: se.clientHeight });
    }
  };

  function destroy(): void {
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    if (w.__fullshotArea__ === handle) delete w.__fullshotArea__;
  }

  function finish(rect: { x: number; y: number; width: number; height: number } | null): void {
    if (done) return;
    done = true;
    destroy();
    const metrics = {
      viewportWidth: se.clientWidth,
      viewportHeight: se.clientHeight,
      innerWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    // Two frames: the page is painted without the overlay before the background captures it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        chrome.runtime.sendMessage({ type: 'AREA_SELECTED', mode, rect, metrics }).catch(() => {});
      }),
    );
  }

  layer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
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
    finish(r);
  });
  layer.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('keydown', onKeyDown, true);

  const handle: OverlayHandle = { destroy };
  w.__fullshotArea__ = handle;
  return true;
}

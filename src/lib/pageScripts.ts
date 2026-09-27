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
import type { PageMetrics } from './types';

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

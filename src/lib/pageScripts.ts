/**
 * Functions injected into the target page with chrome.scripting.executeScript({ func }).
 *
 * IMPORTANT: each function runs in the page's isolated world and is serialized via
 * Function.prototype.toString, so it must be fully self-contained — no references to imports,
 * module-scope variables, or TypeScript helpers. State that must survive across injected calls is
 * stashed on `window.__fullshot__` (the isolated world persists for the tab between calls).
 */
import type { PageMetrics } from './types';

interface FullShotPageState {
  originalScrollX: number;
  originalScrollY: number;
  originalScrollBehavior: string;
  fixed: Array<{ el: HTMLElement; visibility: string }>;
}

declare global {
  interface Window {
    __fullshot__?: FullShotPageState;
  }
}

/** Measure the page, freeze scroll behaviour, and record fixed/sticky elements. Runs once. */
export function prepAndMeasure(): PageMetrics {
  const de = document.documentElement;
  const body = document.body;

  const fullWidth = Math.max(
    de.scrollWidth,
    body ? body.scrollWidth : 0,
    de.clientWidth,
  );
  const fullHeight = Math.max(
    de.scrollHeight,
    body ? body.scrollHeight : 0,
    de.clientHeight,
  );

  // clientWidth/Height exclude scrollbars; using them as the content box means the scrollbar
  // strip in each captured tile falls outside the stitched canvas and is cropped automatically.
  const viewportWidth = de.clientWidth;
  const viewportHeight = de.clientHeight;
  const scrollbarWidth = Math.max(0, window.innerWidth - de.clientWidth);

  const fixed: Array<{ el: HTMLElement; visibility: string }> = [];
  const all = document.body ? document.body.getElementsByTagName('*') : [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement;
    const pos = window.getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      fixed.push({ el, visibility: el.style.visibility });
    }
  }

  window.__fullshot__ = {
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
    originalScrollBehavior: de.style.scrollBehavior,
    fixed,
  };
  de.style.scrollBehavior = 'auto';

  return {
    fullWidth,
    fullHeight,
    viewportWidth,
    viewportHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollbarWidth,
  };
}

/**
 * Scroll to (x, y) and return the actual (clamped) position. Fixed/sticky elements are hidden for
 * every row except the top one, so a sticky header is captured once instead of on every tile.
 */
export function scrollToStep(x: number, y: number): { x: number; y: number } {
  const state = window.__fullshot__;
  const hideFixed = y > 0;
  if (state) {
    for (const item of state.fixed) {
      item.el.style.visibility = hideFixed ? 'hidden' : item.visibility;
    }
  }
  window.scrollTo(x, y);
  return { x: window.scrollX, y: window.scrollY };
}

/** Restore the page to its pre-capture state. */
export function cleanupPage(): void {
  const state = window.__fullshot__;
  if (!state) return;
  for (const item of state.fixed) {
    item.el.style.visibility = item.visibility;
  }
  document.documentElement.style.scrollBehavior = state.originalScrollBehavior;
  window.scrollTo(state.originalScrollX, state.originalScrollY);
  delete window.__fullshot__;
}

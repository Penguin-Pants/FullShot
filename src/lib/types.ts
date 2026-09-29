/** What the popup can ask for: open the editor, or save directly in one format. */
export type CaptureMode = 'edit' | 'png' | 'jpeg' | 'pdf';

/** Which part of the page to capture. */
export type CaptureScope = 'full' | 'visible' | 'area';

/** Everything the injected page script measures about the page before scrolling. */
export interface PageMetrics {
  /** Full scrollable width in CSS px. */
  fullWidth: number;
  /** Full scrollable height in CSS px. */
  fullHeight: number;
  /** Visible viewport width in CSS px, excluding any classic scrollbar. */
  viewportWidth: number;
  /** Visible viewport height in CSS px, excluding any classic scrollbar. */
  viewportHeight: number;
  /** window.innerWidth in CSS px: the width that captureVisibleTab returns, scrollbar included. */
  innerWidth: number;
  /** window.devicePixelRatio as the page reports it (may be spoofed; see stitch.ts). */
  devicePixelRatio: number;
  /** Scroll position before the capture started (restored afterwards). */
  scrollX: number;
  scrollY: number;
}

/** What the visible and area captures need to crop a captureVisibleTab image. */
export interface ViewportMetrics {
  /** Visible viewport size in CSS px, excluding any classic scrollbar. */
  viewportWidth: number;
  viewportHeight: number;
  /**
   * Where the viewport starts in the captured image, in CSS px: the width of a classic scrollbar
   * on the left (Firefox with a right-to-left browser UI), otherwise 0.
   */
  viewportLeft: number;
  /** window.innerWidth in CSS px: the width that captureVisibleTab returns, scrollbar included. */
  innerWidth: number;
  /** window.devicePixelRatio as the page reports it (may be spoofed; see stitch.ts). */
  devicePixelRatio: number;
}

/** A rectangle in CSS px, relative to the top-left corner of the viewport. */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One captured viewport tile plus where it belongs in the final image. */
export interface CaptureTile {
  /** data: URL (PNG) returned by chrome.tabs.captureVisibleTab. */
  dataUrl: string;
  /** Horizontal scroll offset (CSS px) when the tile was taken. */
  x: number;
  /** Vertical scroll offset (CSS px) when the tile was taken. */
  y: number;
}

/* ------------------------------------------------------------------ *
 * Message contract between the popup and the background.
 * ------------------------------------------------------------------ */

/** Popup → background. `tabId` is the tab the popup was opened for (the activeTab grant). */
export interface StartCaptureMessage {
  type: 'START_CAPTURE';
  mode: CaptureMode;
  tabId: number;
  /** Defaults to 'full'. */
  scope?: CaptureScope;
}

/**
 * Page (the area-selection overlay) → background, when the person has dragged a rectangle.
 * `rect` is null when they cancelled (Escape).
 */
export interface AreaSelectedMessage {
  type: 'AREA_SELECTED';
  mode: CaptureMode;
  rect: ViewportRect | null;
  metrics: ViewportMetrics;
}

/** Background → popup(s), broadcast while a capture runs. */
export type CaptureEvent =
  | { type: 'CAPTURE_PROGRESS'; done: number; total: number }
  | { type: 'CAPTURE_DONE' }
  | { type: 'CAPTURE_ERROR'; message: string };

/**
 * Background → popup, the response to START_CAPTURE. `pending: 'area'` means the page now shows
 * the area-selection overlay; the capture runs when the person finishes the selection.
 */
export type StartCaptureResponse = { ok: true; pending?: 'area' } | { ok: false; error: string; stage: string };

/** Sync-storage key for user options. */
export const OPTIONS_KEY = 'fullshot:options';

export interface FullShotOptions {
  /** JPEG quality 0..1 (also used for the PDF's JPEG-encoded pages). */
  jpegQuality: number;
  /** Stamp the source URL + date onto PDF pages. */
  stampUrlAndDate: boolean;
}

export const DEFAULT_OPTIONS: FullShotOptions = {
  jpegQuality: 0.92,
  stampUrlAndDate: false,
};

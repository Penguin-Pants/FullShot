/** What the popup can ask for: open the editor, or save directly in one format. */
export type CaptureMode = 'edit' | 'png' | 'jpeg' | 'pdf';

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
}

/** Background → popup(s), broadcast while a capture runs. */
export type CaptureEvent =
  | { type: 'CAPTURE_PROGRESS'; done: number; total: number }
  | { type: 'CAPTURE_DONE' }
  | { type: 'CAPTURE_ERROR'; message: string };

/** Background → popup, the response to START_CAPTURE. */
export type StartCaptureResponse = { ok: true } | { ok: false; error: string; stage: string };

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

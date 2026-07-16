/** Output image formats the extension can produce directly (before/without the editor). */
export type ImageFormat = 'png' | 'jpeg';

/** Everything the content script measures about the page before scrolling. */
export interface PageMetrics {
  /** Full scrollable width in CSS px. */
  fullWidth: number;
  /** Full scrollable height in CSS px. */
  fullHeight: number;
  /** Visible viewport width in CSS px. */
  viewportWidth: number;
  /** Visible viewport height in CSS px. */
  viewportHeight: number;
  /** devicePixelRatio at capture time (captureVisibleTab returns physical pixels). */
  devicePixelRatio: number;
  /** Width of the scrollbar gutter in CSS px, so it can be cropped out of tiles. */
  scrollbarWidth: number;
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

/** A finished capture handed to the popup / editor / downloader. */
export interface CaptureResult {
  /** data: URL of the stitched full-page image (PNG). */
  dataUrl: string;
  /** Final pixel width. */
  width: number;
  /** Final pixel height. */
  height: number;
  /** Source page URL, for stamping / filenames. */
  pageUrl: string;
  /** Source page title, for filenames. */
  pageTitle: string;
  /** Capture timestamp (ms since epoch). */
  capturedAt: number;
}

/* ------------------------------------------------------------------ *
 * Message contract. Every message has a `type` discriminator so the
 * receivers (background, content, editor) can switch exhaustively.
 * ------------------------------------------------------------------ */

export type Message =
  | { type: 'CAPTURE_FULL_PAGE' }
  | { type: 'CAPTURE_VISIBLE'; /* asks background to snapshot the current viewport */ }
  | { type: 'CAPTURE_PROGRESS'; done: number; total: number }
  | { type: 'CAPTURE_DONE'; result: CaptureResult }
  | { type: 'CAPTURE_ERROR'; message: string }
  | { type: 'OPEN_EDITOR'; captureId: string };

export type CaptureVisibleResponse =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

/** Session-storage key under which a pending capture is stashed for the editor tab. */
export const PENDING_CAPTURE_KEY = 'fullshot:pendingCapture';

/** Sync-storage key for user options. */
export const OPTIONS_KEY = 'fullshot:options';

export interface FullShotOptions {
  /** Default one-click export format from the popup. */
  defaultFormat: ImageFormat | 'pdf';
  /** JPEG quality 0..1 (also used for the PDF's JPEG-encoded pages). */
  jpegQuality: number;
  /** Open the editor automatically after capture instead of downloading. */
  openEditorAfterCapture: boolean;
  /** Stamp the source URL + date onto exports. */
  stampUrlAndDate: boolean;
}

export const DEFAULT_OPTIONS: FullShotOptions = {
  defaultFormat: 'png',
  jpegQuality: 0.92,
  openEditorAfterCapture: true,
  stampUrlAndDate: false,
};

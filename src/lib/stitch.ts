/**
 * Composite the captured viewport tiles into one full-page image using OffscreenCanvas.
 * Runs in the background (Chrome service worker / Firefox event page). All math is in the
 * physical pixels that captureVisibleTab returns.
 */
import type { CaptureTile, PageMetrics, ViewportMetrics, ViewportRect } from './types';

/**
 * Widely-safe maximum canvas dimension. Chrome's hard limit is higher, but very tall canvases
 * fail unpredictably; if the page exceeds this we downscale uniformly so the export still succeeds
 * (rather than clipping content).
 */
export const SAFE_MAX_CANVAS_DIM = 32767;

export interface StitchResult {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  /** Uniform scale applied (1 unless the page was too large for the canvas). */
  scale: number;
  /** Pixels per CSS px of the captured tiles. */
  pixelScale: number;
}

export interface StitchOptions {
  /** Fill colour behind the tiles (JPEG and PDF have no alpha channel). */
  background?: string;
}

/**
 * Pixels per CSS px of the captured tiles.
 *
 * captureVisibleTab captures at the browser's real device scale, but window.devicePixelRatio is
 * whatever the page is told (Firefox's resistFingerprinting reports a spoofed value). So measure
 * the scale from the first tile, and keep the reported value only when it agrees (it is exact,
 * while the measured one carries innerWidth's rounding at fractional zoom levels).
 */
export function tilePixelScale(
  tileWidthPx: number,
  metrics: Pick<PageMetrics, 'innerWidth' | 'devicePixelRatio'>,
): number {
  const reported = metrics.devicePixelRatio || 1;
  if (!metrics.innerWidth || !tileWidthPx) return reported;
  const measured = tileWidthPx / metrics.innerWidth;
  return Math.abs(measured - reported) / measured < 0.02 ? reported : measured;
}

/**
 * Draw every tile at its (clamped) scroll offset. Because tiles are drawn in capture order and
 * later tiles overwrite earlier pixels, the natural overlap of the final clamped row/column
 * resolves correctly.
 */
export async function stitchTiles(
  tiles: CaptureTile[],
  metrics: PageMetrics,
  opts: StitchOptions = {},
): Promise<StitchResult> {
  if (!tiles.length) throw new Error('No tiles were captured.');
  const first = await bitmapFromDataUrl(tiles[0].dataUrl);
  const dpr = tilePixelScale(first.width, metrics);
  const fullW = Math.round(metrics.fullWidth * dpr);
  const fullH = Math.round(metrics.fullHeight * dpr);

  // Downscale if the page is larger than a canvas can safely hold.
  const scale = Math.min(1, SAFE_MAX_CANVAS_DIM / Math.max(fullW, fullH));
  const canvasW = Math.max(1, Math.round(fullW * scale));
  const canvasH = Math.max(1, Math.round(fullH * scale));

  const canvas = new OffscreenCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D context for stitching.');

  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  for (let i = 0; i < tiles.length; i++) {
    const bmp = i === 0 ? first : await bitmapFromDataUrl(tiles[i].dataUrl);
    const dx = Math.round(tiles[i].x * dpr * scale);
    const dy = Math.round(tiles[i].y * dpr * scale);
    const dw = Math.round(bmp.width * scale);
    const dh = Math.round(bmp.height * scale);
    ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, dx, dy, dw, dh);
    bmp.close();
  }

  return { canvas, width: canvasW, height: canvasH, scale, pixelScale: dpr };
}

/**
 * Cut a rectangle (CSS px, relative to the viewport) out of one captureVisibleTab image. Used by
 * the visible-area capture (the rectangle is the viewport without a classic scrollbar) and the
 * area capture (the rectangle the person dragged).
 */
export async function cropViewport(
  dataUrl: string,
  metrics: ViewportMetrics,
  rect: ViewportRect,
  opts: StitchOptions = {},
): Promise<StitchResult> {
  const bmp = await bitmapFromDataUrl(dataUrl);
  const dpr = tilePixelScale(bmp.width, metrics);
  const sx = Math.min(Math.max(0, Math.round(rect.x * dpr)), bmp.width - 1);
  const sy = Math.min(Math.max(0, Math.round(rect.y * dpr)), bmp.height - 1);
  const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rect.width * dpr)));
  const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rect.height * dpr)));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D context for cropping.');
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, sw, sh);
  }
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();
  return { canvas, width: sw, height: sh, scale: 1, pixelScale: dpr };
}

async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

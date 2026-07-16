/**
 * Composite the captured viewport tiles into one full-page image using OffscreenCanvas.
 * Runs in the service worker. captureVisibleTab returns physical pixels (already scaled by
 * devicePixelRatio), so all math here is in physical pixels.
 */
import type { CaptureTile, PageMetrics } from './types';

/**
 * Widely-safe maximum canvas dimension. Chrome's hard limit is higher, but very tall canvases
 * fail unpredictably; if the page exceeds this we downscale uniformly so the export still succeeds
 * (rather than clipping content).
 */
export const SAFE_MAX_CANVAS_DIM = 32767;

export interface StitchResult {
  blob: Blob;
  width: number;
  height: number;
  /** Uniform scale applied (1 unless the page was too large for the canvas). */
  scale: number;
}

export interface StitchOptions {
  type?: 'image/png' | 'image/jpeg';
  quality?: number;
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
  const dpr = metrics.devicePixelRatio || 1;
  const fullW = Math.round(metrics.fullWidth * dpr);
  const fullH = Math.round(metrics.fullHeight * dpr);

  // Downscale if the page is larger than a canvas can safely hold.
  const scale = Math.min(1, SAFE_MAX_CANVAS_DIM / Math.max(fullW, fullH));
  const canvasW = Math.max(1, Math.round(fullW * scale));
  const canvasH = Math.max(1, Math.round(fullH * scale));

  const canvas = new OffscreenCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D context for stitching.');

  // JPEG has no alpha; paint white so transparent page regions do not turn black.
  if (opts.type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  for (const tile of tiles) {
    const bmp = await bitmapFromDataUrl(tile.dataUrl);
    const dx = Math.round(tile.x * dpr * scale);
    const dy = Math.round(tile.y * dpr * scale);
    const dw = Math.round(bmp.width * scale);
    const dh = Math.round(bmp.height * scale);
    ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, dx, dy, dw, dh);
    bmp.close();
  }

  const blob = await canvas.convertToBlob({
    type: opts.type ?? 'image/png',
    quality: opts.quality,
  });

  return { blob, width: canvasW, height: canvasH, scale };
}

async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

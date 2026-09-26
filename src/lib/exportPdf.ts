/**
 * Render a full-page capture into a multi-page PDF, entirely in the browser via jsPDF.
 *
 * Works on an HTMLCanvasElement (the editor) or an OffscreenCanvas (the background's stitched
 * capture), so Quick PDF and the editor's PDF button share one implementation. It uses no DOM
 * APIs, which keeps it usable in Chrome's service worker.
 *
 * "Smart page splitting": the image is scaled to the page width and sliced across pages. Instead of
 * cutting at a fixed height (which slices through text), each break is nudged to a nearby low-energy
 * horizontal row — a band with little vertical change, i.e. whitespace between content.
 */
import { jsPDF } from 'jspdf';

const A4_PT = { w: 595.28, h: 841.89 };
const SEARCH_WINDOW_PX = 48; // how far to look for a nicer break above the ideal one

export type PdfSource = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface PdfExportMeta {
  pageUrl: string;
  capturedAt: number;
  quality: number;
  stamp: boolean;
}

/**
 * Find the row in [ideal - window, ideal] that differs least from the row above it; fall back to
 * ideal. Only the rows in the window are read, so memory use does not grow with the capture size.
 */
function bestBreak(ctx: Ctx2D, width: number, ideal: number, minY: number): number {
  const lo = Math.max(minY + 1, ideal - SEARCH_WINDOW_PX);
  const hi = ideal;
  if (hi <= lo) return ideal;
  // Rows lo-1 .. hi: the energy of row y compares it with row y-1.
  const { data } = ctx.getImageData(0, lo - 1, width, hi - lo + 2);
  const stepX = Math.max(1, Math.floor(width / 300)); // sample columns for speed
  const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let best = ideal;
  let bestVal = Infinity;
  for (let y = hi; y >= lo; y--) {
    const row = (y - lo + 1) * width * 4;
    const prev = (y - lo) * width * 4;
    let sum = 0;
    for (let x = 0; x < width; x += stepX) {
      sum += Math.abs(lum(row + x * 4) - lum(prev + x * 4));
    }
    if (sum < bestVal) {
      bestVal = sum;
      best = y;
    }
  }
  return best;
}

export async function buildPdf(source: PdfSource, meta: PdfExportMeta): Promise<Blob> {
  const imgW = source.width;
  const imgH = source.height;
  const ctx = source.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('Could not read the capture for PDF export.');

  // px -> pt scale so the image spans the page width.
  const scale = A4_PT.w / imgW;
  const idealSliceHpx = Math.floor(A4_PT.h / scale);

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const slice = new OffscreenCanvas(imgW, Math.max(1, Math.min(imgH, idealSliceHpx)));
  const sctx = slice.getContext('2d');
  if (!sctx) throw new Error('Could not create a canvas for PDF export.');

  let y = 0;
  let first = true;
  while (y < imgH) {
    const ideal = y + idealSliceHpx;
    const brk = ideal >= imgH ? imgH : bestBreak(ctx, imgW, ideal, y);
    const sliceH = Math.max(1, brk - y);

    if (slice.height !== sliceH) slice.height = sliceH;
    // JPEG has no alpha; paint white so transparent regions do not turn black.
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, imgW, sliceH);
    sctx.drawImage(source, 0, y, imgW, sliceH, 0, 0, imgW, sliceH);
    const jpeg = await slice.convertToBlob({ type: 'image/jpeg', quality: meta.quality });

    if (!first) pdf.addPage();
    first = false;
    pdf.addImage(new Uint8Array(await jpeg.arrayBuffer()), 'JPEG', 0, 0, A4_PT.w, sliceH * scale, undefined, 'FAST');

    if (meta.stamp) stampPage(pdf, meta);
    y += sliceH;
  }

  return pdf.output('blob');
}

function stampPage(pdf: jsPDF, meta: PdfExportMeta): void {
  const text = `${meta.pageUrl} — ${new Date(meta.capturedAt).toLocaleString()}`;
  pdf.setFontSize(7);
  pdf.setTextColor(120);
  pdf.text(text.slice(0, 140), 6, A4_PT.h - 6);
}

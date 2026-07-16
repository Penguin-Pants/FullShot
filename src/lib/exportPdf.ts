/**
 * Render a flattened screenshot canvas into a multi-page PDF, entirely in the browser via jsPDF.
 *
 * "Smart page splitting": the image is scaled to the page width and sliced across pages. Instead of
 * cutting at a fixed height (which slices through text), each break is nudged to a nearby low-energy
 * horizontal row — a band with little vertical change, i.e. whitespace between content.
 */
import { jsPDF } from 'jspdf';
import { buildFilename } from './filename';

const A4_PT = { w: 595.28, h: 841.89 };
const SEARCH_WINDOW_PX = 48; // how far to look for a nicer break above the ideal one

export interface PdfExportMeta {
  pageUrl: string;
  capturedAt: number;
  quality: number;
  stamp: boolean;
}

/** Precompute a per-row "energy" score: high where the row differs from the one above it. */
function computeRowEnergy(canvas: HTMLCanvasElement): Float32Array {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const energy = new Float32Array(height);
  if (!ctx) return energy;
  const data = ctx.getImageData(0, 0, width, height).data;
  const stepX = Math.max(1, Math.floor(width / 300)); // sample columns for speed
  const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  for (let y = 1; y < height; y++) {
    let sum = 0;
    const row = y * width * 4;
    const prev = (y - 1) * width * 4;
    for (let x = 0; x < width; x += stepX) {
      sum += Math.abs(lum(row + x * 4) - lum(prev + x * 4));
    }
    energy[y] = sum;
  }
  return energy;
}

/** Find the lowest-energy row within [ideal - window, ideal]; fall back to ideal. */
function bestBreak(energy: Float32Array, ideal: number, minY: number): number {
  const lo = Math.max(minY + 1, ideal - SEARCH_WINDOW_PX);
  const hi = Math.min(energy.length - 1, ideal);
  if (hi <= lo) return ideal;
  let best = ideal;
  let bestVal = Infinity;
  for (let y = hi; y >= lo; y--) {
    if (energy[y] < bestVal) {
      bestVal = energy[y];
      best = y;
    }
  }
  return best;
}

export async function exportCanvasToPdf(
  source: HTMLCanvasElement,
  meta: PdfExportMeta,
): Promise<void> {
  const imgW = source.width;
  const imgH = source.height;

  // px -> pt scale so the image spans the page width.
  const scale = A4_PT.w / imgW;
  const idealSliceHpx = Math.floor(A4_PT.h / scale);

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });

  // Single short capture: one page sized to the image, no slicing needed.
  const singlePage = imgH <= idealSliceHpx;
  const energy = singlePage ? new Float32Array(0) : computeRowEnergy(source);

  const slice = document.createElement('canvas');
  const sctx = slice.getContext('2d')!;

  let y = 0;
  let first = true;
  while (y < imgH) {
    let sliceH: number;
    if (singlePage) {
      sliceH = imgH;
    } else {
      const ideal = Math.min(imgH, y + idealSliceHpx);
      const brk = ideal >= imgH ? imgH : bestBreak(energy, ideal, y);
      sliceH = Math.max(1, brk - y);
    }

    slice.width = imgW;
    slice.height = sliceH;
    sctx.clearRect(0, 0, imgW, sliceH);
    sctx.drawImage(source, 0, y, imgW, sliceH, 0, 0, imgW, sliceH);
    const dataUrl = slice.toDataURL('image/jpeg', meta.quality);

    if (!first) pdf.addPage();
    first = false;
    pdf.addImage(dataUrl, 'JPEG', 0, 0, A4_PT.w, sliceH * scale, undefined, 'FAST');

    if (meta.stamp) stampPage(pdf, meta);
    y += sliceH;
  }

  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename: buildFilename(meta.pageUrl, meta.capturedAt, 'pdf'),
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function stampPage(pdf: jsPDF, meta: PdfExportMeta): void {
  const text = `${meta.pageUrl} — ${new Date(meta.capturedAt).toLocaleString()}`;
  pdf.setFontSize(7);
  pdf.setTextColor(120);
  pdf.text(text.slice(0, 140), 6, A4_PT.h - 6);
}

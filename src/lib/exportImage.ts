import { buildFilename } from './filename';
import { downloadBlob } from './download';

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed.'))),
      type,
      quality,
    );
  });
}

/** Trigger a download of a rendered canvas as PNG or JPEG. */
export async function downloadCanvas(
  canvas: HTMLCanvasElement,
  format: 'png' | 'jpeg',
  quality: number,
  pageUrl: string,
): Promise<void> {
  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const blob = await canvasToBlob(canvas, type, format === 'jpeg' ? quality : undefined);
  await downloadBlob(blob, buildFilename(pageUrl, Date.now(), ext));
}

/** Copy a rendered canvas to the clipboard as a PNG. */
export async function copyCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await canvasToBlob(canvas, 'image/png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

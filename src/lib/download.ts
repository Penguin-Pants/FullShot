import { blobToDataUrl } from './blob';

/**
 * Save a Blob to the Downloads folder.
 *
 * Firefox's downloads.download() rejects data: URLs ("Access denied for URL data:…"), while
 * Chrome's MV3 service worker has no URL.createObjectURL. So use an object URL wherever one can
 * be created (Firefox's background page and every extension page) and fall back to a data: URL
 * only where it cannot (Chrome's service worker, which accepts data: URLs).
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const canUseObjectUrl = typeof URL.createObjectURL === 'function';
  const url = canUseObjectUrl ? URL.createObjectURL(blob) : await blobToDataUrl(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // The download reads the URL after download() resolves; give it a moment before revoking.
    if (canUseObjectUrl) setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

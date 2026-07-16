/**
 * Blob/base64 helpers that work in a service worker, where FileReader and
 * URL.createObjectURL are unavailable.
 */

/** Encode an ArrayBuffer to a base64 string in chunks (avoids call-stack blowups). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32 KB per fromCharCode call
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/** Convert a Blob to a data: URL without FileReader (service-worker safe). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);
  return `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
}

/** Decode a data: URL (any type) into a Blob. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

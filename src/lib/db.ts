/**
 * Tiny IndexedDB store for handing large capture blobs from the service worker to the
 * editor / offscreen contexts. IndexedDB (with the `unlimitedStorage` permission) comfortably
 * holds multi-megabyte full-page screenshots, unlike chrome.storage.session's small quota.
 */
import type { CaptureResult } from './types';

const DB_NAME = 'fullshot';
const STORE = 'captures';
const DB_VERSION = 1;

export interface StoredCapture {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  pageUrl: string;
  pageTitle: string;
  capturedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putCapture(entry: StoredCapture): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getCapture(id: string): Promise<StoredCapture | undefined> {
  const db = await openDb();
  try {
    return await new Promise<StoredCapture | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as StoredCapture | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteCapture(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Convenience: shape a StoredCapture's metadata as a CaptureResult (sans blob). */
export function toCaptureMeta(entry: StoredCapture): Omit<CaptureResult, 'dataUrl'> {
  return {
    width: entry.width,
    height: entry.height,
    pageUrl: entry.pageUrl,
    pageTitle: entry.pageTitle,
    capturedAt: entry.capturedAt,
  };
}

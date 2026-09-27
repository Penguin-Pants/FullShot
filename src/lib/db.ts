/**
 * Tiny IndexedDB store for handing large capture blobs from the background to the editor tab.
 * IndexedDB (with the `unlimitedStorage` permission) comfortably holds multi-megabyte full-page
 * screenshots, unlike chrome.storage.session's small quota.
 *
 * Only captures opened in the editor are stored, and only the most recent few are kept (the
 * editor needs its entry again only if its tab is reloaded).
 */
const DB_NAME = 'fullshot';
const STORE = 'captures';
const DB_VERSION = 1;

/** How many captures to keep for the editor; older ones are deleted when a new one is stored. */
export const MAX_STORED_CAPTURES = 10;

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

/** Store a capture, then delete all but the newest MAX_STORED_CAPTURES. */
export async function putCapture(entry: StoredCapture): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(entry);
      const all = store.getAll();
      all.onsuccess = () => {
        const stale = (all.result as StoredCapture[])
          .sort((a, b) => b.capturedAt - a.capturedAt)
          .slice(MAX_STORED_CAPTURES);
        for (const old of stale) store.delete(old.id);
      };
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

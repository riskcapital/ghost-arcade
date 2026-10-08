/** Blob persistence keeps imported clips available after restarting the native shell. */
let connection: Promise<IDBDatabase> | undefined;
function db() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ghost-mobile-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connection = undefined;
      reject(new Error('Local media storage is unavailable.'));
    };
  }));
}
export async function putAsset(id: string, blob: Blob): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('assets', 'readwrite');
    tx.objectStore('assets').put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Not enough local storage to save this clip.'));
    tx.onabort = () => reject(new Error('Media import was interrupted.'));
  });
}
export async function getAsset(id: string): Promise<Blob | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('assets').objectStore('assets').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not read the saved clip.'));
  });
}
export type AssetInfo = { id: string; bytes: number; type: string };
/** Every imported file on this device with its size. */
export async function listAssets(): Promise<AssetInfo[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const found: AssetInfo[] = [];
    const request = database.transaction('assets').objectStore('assets').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(found); return; }
      const blob = cursor.value as Blob | undefined;
      found.push({ id: String(cursor.key), bytes: blob?.size ?? 0, type: blob?.type ?? '' });
      cursor.continue();
    };
    request.onerror = () => reject(new Error('Could not read local media storage.'));
  });
}
export async function deleteAssets(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('assets', 'readwrite');
    const store = tx.objectStore('assets');
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('Could not delete the media. Try again.'));
  });
}
/** Imported files no clip uses any more, given the ids that are still referenced. */
export function unusedAssets(all: AssetInfo[], referenced: Set<string>): AssetInfo[] {
  return all.filter((asset) => !referenced.has(asset.id));
}
export const totalBytes = (assets: AssetInfo[]) => assets.reduce((sum, asset) => sum + asset.bytes, 0);
/** "12.4 MB", "830 KB": short sizes for the storage summary. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}

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

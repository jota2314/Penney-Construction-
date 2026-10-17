export interface SavedPhoto {
  id: string;
  logId: string;
  file: Blob;
  /** Already shrunk to upload size before it was stored. */
  shrunk?: boolean;
  /**
   * The upload route this photo goes to. The crew app and the sub portal
   * share this store; each restores only its own photos. Photos saved before
   * this field existed have none and are crew photos (/api/crew/daily-log-photo).
   */
  endpoint?: string;
}
// Same database and version as before: a new field needs no upgrade, and a
// version bump would be blocked by any tab still open on an older bundle.
const DATABASE = "penney-daily-log-photos";
const STORE = "pending";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Photo storage is busy. Close other Penney tabs and try again."));
  });
}

export async function savePhotos(photos: SavedPhoto[]): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Could not save photos on this device."));
      tx.onerror = () => reject(tx.error);
      for (const photo of photos) tx.objectStore(STORE).put(photo);
    });
  } finally { db.close(); }
}

export async function loadPhotos(): Promise<SavedPhoto[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function removePhoto(id: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(id);
    });
  } finally { db.close(); }
}

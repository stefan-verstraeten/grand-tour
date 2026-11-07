// Photos taken during the trip. The image itself lives in IndexedDB on the phone
// (localStorage is far too small); its details travel with the notes, and when
// sharing is set up notes.js also uploads the image, encrypted.

const DB = 'grandtour-media';
const STORE = 'photos';
const MAX_SIDE = 1600;

let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const media = {
  get: (id) => tx('readonly', (s) => s.get(id)),
  put: (id, blob) => tx('readwrite', (s) => s.put(blob, id)),
  del: (id) => tx('readwrite', (s) => s.delete(id)),
};

// Scales a picked photo down to at most MAX_SIDE pixels and re-encodes it as JPEG,
// which also turns iPhone HEIC photos into something every browser can show.
export async function preparePhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.82));
  return { blob, w, h };
}

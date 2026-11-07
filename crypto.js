// Passphrase-based encryption shared by the app (browser) and tools/vault.mjs (Node).
// PBKDF2-SHA256 derives an AES-256-GCM key; the box is plain JSON so it can be committed.

const te = new TextEncoder();
const td = new TextDecoder();

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// Typing on an iPhone tends to capitalise the first letter or add a trailing space.
export function normalizePass(pass) {
  return String(pass).normalize('NFC').trim().toLowerCase();
}

async function deriveKey(pass, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(normalizePass(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(obj, pass, iterations = 310000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(ct)) };
}

// Throws when the passphrase is wrong (AES-GCM authentication fails).
export async function decryptJSON(box, pass) {
  const key = await deriveKey(pass, fromB64(box.salt), box.iterations);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
  return JSON.parse(td.decode(pt));
}

// A random AES key stored inside the encrypted trip data. Photos and notes are
// encrypted with it directly, so they don't each need a slow PBKDF2 derivation.

export async function newContentKey() {
  return toB64(crypto.getRandomValues(new Uint8Array(32)));
}

export function importContentKey(b64) {
  return crypto.subtle.importKey('raw', fromB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Output layout: 12-byte IV followed by the ciphertext.
export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12)));
}

export async function encryptText(key, text) {
  return toB64(await encryptBytes(key, te.encode(text)));
}

export async function decryptText(key, b64) {
  return td.decode(await decryptBytes(key, fromB64(b64)));
}

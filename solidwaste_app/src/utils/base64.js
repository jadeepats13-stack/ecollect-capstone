// base64 text -> ArrayBuffer (for uploading a photo; no extra library needed).
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < CHARS.length; i++) LOOKUP[CHARS.charCodeAt(i)] = i;

export function base64ToArrayBuffer(b64) {
  const s = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((s.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = LOOKUP[s.charCodeAt(i)], b = LOOKUP[s.charCodeAt(i + 1)];
    const c = LOOKUP[s.charCodeAt(i + 2)], d = LOOKUP[s.charCodeAt(i + 3)];
    if (p < len) out[p++] = (a << 2) | (b >> 4);
    if (p < len && i + 2 < s.length) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < len && i + 3 < s.length) out[p++] = ((c & 3) << 6) | d;
  }
  return out.buffer;
}

const encoder = new TextEncoder();

// 32-bit FNV-1a over the UTF-8 bytes, as 8 lowercase hex chars.
export function fnv1a(str) {
  const bytes = encoder.encode(String(str ?? ""));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

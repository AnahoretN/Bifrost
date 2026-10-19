// UUID helpers. fileId is stable across all peers; transferKey pairs it with a peer.

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (plain http on LAN) where crypto.randomUUID
  // is unavailable — Math.random is fine for room/file IDs here.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 16 bytes of a uuid → for the compact binary chunk header. */
export function uuidToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function uuidFromBytes(bytes: Uint8Array, offset = 0): string {
  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += bytes[offset + i].toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20, 32)}`;
}

export function transferKey(
  fileId: string,
  peerId: string,
  direction: 'send' | 'receive'
) {
  return `${fileId}:${peerId}:${direction}` as const;
}

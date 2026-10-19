// Binary frame codec for the 'bin' (file chunks) and 'prv' (preview bytes)
// Trystero actions — both use the same frame layout:
//   [0..16)  file id (uuid, 16 bytes)
//   [16..20) chunk index (u32 BE)
//   [20..24) CRC32 of payload (u32 BE)
//   [24..)   payload
// Previews ride their own action so they can't collide with file chunk 0.

import { BIN_HEADER_SIZE } from '../types';
import { crc32 } from './crc32';
import { uuidFromBytes, uuidToBytes } from '../utils/id';

export interface BinFrame {
  fileId: string;
  index: number;
  payload: Uint8Array;
}

export function encodeFrame(fileId: string, index: number, payload: Uint8Array): ArrayBuffer {
  const frame = new Uint8Array(BIN_HEADER_SIZE + payload.length);
  frame.set(uuidToBytes(fileId), 0);
  const view = new DataView(frame.buffer);
  view.setUint32(16, index, false);
  view.setUint32(20, crc32(payload), false);
  frame.set(payload, BIN_HEADER_SIZE);
  return frame.buffer;
}

/**
 * Decodes header + payload. Truncated frames return null (unrecoverable);
 * CRC failures still return the frame with `crcOk: false` so the receiver
 * can NAK the right transfer/index.
 */
export function decodeFrame(buffer: ArrayBuffer): (BinFrame & { crcOk: boolean }) | null {
  if (buffer.byteLength < BIN_HEADER_SIZE) return null;
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const payload = bytes.slice(BIN_HEADER_SIZE);
  const expectedCrc = view.getUint32(20, false);
  return {
    fileId: uuidFromBytes(bytes, 0),
    index: view.getUint32(16, false),
    payload,
    crcOk: crc32(payload) === expectedCrc,
  };
}

export { crc32 };

/** Copy a view into its own ArrayBuffer (Blob/writable-safe across TS lib versions). */
export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

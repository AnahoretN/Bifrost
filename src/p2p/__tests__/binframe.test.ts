import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, crc32 } from '../binframe';

describe('crc32', () => {
  it('matches known vectors', () => {
    const enc = new TextEncoder();
    expect(crc32(enc.encode(''))).toBe(0x00000000);
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('binframe round-trip', () => {
  const id = 'a3bb189e-8bf9-4888-9912-ace4e6543002';

  it('round-trips fileId, index and payload', () => {
    const payload = new Uint8Array(1024).map((_, i) => i % 251);
    const frame = encodeFrame(id, 12345, payload);
    const decoded = decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded!.fileId).toBe(id);
    expect(decoded!.index).toBe(12345);
    expect(decoded!.crcOk).toBe(true);
    expect(Array.from(decoded!.payload)).toEqual(Array.from(payload));
  });

  it('flags a corrupted payload via crcOk (header stays readable for NAK)', () => {
    const frame = encodeFrame(id, 7, new Uint8Array([1, 2, 3, 4]));
    const bytes = new Uint8Array(frame);
    expect(bytes.length).toBe(24 + 4); // header + payload — flip inside it
    bytes[25] ^= 0xff; // flip a payload byte
    const decoded = decodeFrame(bytes.buffer);
    expect(decoded).not.toBeNull();
    expect(decoded!.fileId).toBe(id);
    expect(decoded!.index).toBe(7);
    expect(decoded!.crcOk).toBe(false);
  });

  it('returns null for truncated frames', () => {
    expect(decodeFrame(new ArrayBuffer(10))).toBeNull();
    expect(decodeFrame(new ArrayBuffer(0))).toBeNull();
  });
});

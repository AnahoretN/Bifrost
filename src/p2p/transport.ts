import type { CtrlMessage, PeerId } from '../types';

/**
 * Transport contract — thin, transport-agnostic surface the session controller
 * codes against (shape follows a proven transport contract).
 * Trystero peer ids are strings; binary frames are pre-encoded ArrayBuffers.
 */
export interface Transport {
  /** Join as host. Resolves once the room is live (peers may arrive later). */
  hostRoom(roomId: string): Promise<void>;
  /** Join as guest; resolves when the room is live (NOT when a peer is seen —
   * the caller drives peer discovery via waitForFirstPeer). */
  joinAsGuest(roomId: string): Promise<void>;
  /** Resolves true when any peer is in the room; false after timeoutMs.
   * Tracker discovery is slow (can take 80s) — callers must not give up early. */
  waitForFirstPeer(timeoutMs: number): Promise<boolean>;
  sendCtrl(msg: CtrlMessage, targetPeer?: PeerId): void;
  broadcastCtrl(msg: CtrlMessage): void;
  sendBin(frame: ArrayBuffer, targetPeer: PeerId): void;
  /** Preview bytes ride a separate action so they can't be confused with
   * file chunk 0 (both would carry index 0 in the frame header). */
  sendPreview(frame: ArrayBuffer, targetPeer: PeerId): void;
  onCtrl(cb: (msg: CtrlMessage, fromPeerId: PeerId) => void): () => void;
  onBin(cb: (data: unknown, fromPeerId: PeerId) => void): () => void;
  onPreview(cb: (data: unknown, fromPeerId: PeerId) => void): () => void;
  onPeerJoin(cb: (peerId: PeerId) => void): () => void;
  onPeerLeave(cb: (peerId: PeerId) => void): () => void;
  getPeerIds(): PeerId[];
  leave(): Promise<void>;
}

// Wire-protocol dispatcher: routes every 'ctl' message to a handler.
// Kept pure (deps injected) so the handshake/routing matrix is unit-testable
// without a real Trystero room.

import type { CtrlMessage, PeerId } from '../types';

export interface ProtocolDeps {
  isHost: () => boolean;
  hostId: () => PeerId | null;
  selfId: () => PeerId;

  // Session
  onHello: (payload: unknown, from: PeerId) => void;
  onManifest: (payload: unknown, from: PeerId) => void;
  onHostPing: (from: PeerId) => void;
  onHostReloading: () => void;

  // Pool
  onPoolUpdate: (payload: unknown) => void;
  onFileAdded: (payload: unknown, from: PeerId) => void;
  onFileRemoved: (payload: unknown, from: PeerId) => void;
  onHaveReport: (payload: unknown, from: PeerId) => void;
  onPreviewReq: (payload: unknown, from: PeerId) => void;

  // Transfers
  onDownloadReq: (payload: unknown, from: PeerId) => void;
  onOffer: (payload: unknown, from: PeerId) => void;
  onAccept: (payload: unknown, from: PeerId) => void;
  onReject: (payload: unknown, from: PeerId) => void;
  onAck: (payload: unknown, from: PeerId) => void;
  onNak: (payload: unknown, from: PeerId) => void;
  onPause: (payload: unknown, from: PeerId) => void;
  onResume: (payload: unknown, from: PeerId) => void;
  onCancel: (payload: unknown, from: PeerId) => void;
  onComplete: (payload: unknown, from: PeerId) => void;
}

/**
 * Host/guest split mirrors the reference protocol:
 *  • only the HOST processes HELLO (a guest receiving another guest's HELLO
 *    must not answer — pseudo-hosting);
 *  • only GUESTS apply POOL_MANIFEST (the host already has the authority copy).
 */
export function createProtocolHandler(deps: ProtocolDeps) {
  return (msg: CtrlMessage, from: PeerId): void => {
    if (!msg || typeof msg.type !== 'string') return;
    const p = msg.payload;

    switch (msg.type) {
      // ── Session ──
      case 'HELLO':
        if (deps.isHost()) deps.onHello(p, from);
        return;
      case 'POOL_MANIFEST':
        if (!deps.isHost()) deps.onManifest(p, from);
        return;
      case 'HOST_PING':
        deps.onHostPing(from);
        return;
      case 'HOST_RELOADING':
        if (!deps.isHost()) deps.onHostReloading();
        return;

      // ── Pool ──
      case 'POOL_UPDATE':
        if (!deps.isHost()) deps.onPoolUpdate(p);
        return;
      case 'FILE_ADDED':
        if (deps.isHost()) deps.onFileAdded(p, from);
        return;
      case 'FILE_REMOVED':
        if (deps.isHost()) deps.onFileRemoved(p, from);
        return;
      case 'HAVE_REPORT':
        if (deps.isHost()) deps.onHaveReport(p, from);
        return;
      case 'PREVIEW_REQ':
        deps.onPreviewReq(p, from);
        return;

      // ── Transfers ──
      case 'DOWNLOAD_REQ':
        deps.onDownloadReq(p, from);
        return;
      case 'TRANSFER_OFFER':
        deps.onOffer(p, from);
        return;
      case 'TRANSFER_ACCEPT':
        deps.onAccept(p, from);
        return;
      case 'TRANSFER_REJECT':
        deps.onReject(p, from);
        return;
      case 'CHUNK_ACK':
        deps.onAck(p, from);
        return;
      case 'CHUNK_NAK':
        deps.onNak(p, from);
        return;
      case 'PAUSE':
        deps.onPause(p, from);
        return;
      case 'RESUME':
        deps.onResume(p, from);
        return;
      case 'CANCEL':
        deps.onCancel(p, from);
        return;
      case 'TRANSFER_COMPLETE':
        deps.onComplete(p, from);
        return;
    }
  };
}

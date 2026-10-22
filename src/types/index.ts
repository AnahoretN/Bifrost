// ── Domain ────────────────────────────────────────────────────────────────────

export type PeerId = string;

export interface PeerInfo {
  id: PeerId;
  name: string;
  isHost: boolean;
  joinedAt: number;
  lastSeen: number;
}

export type LocalFileState = 'local' | 'remote' | 'partial';

export interface PreviewInfo {
  ready: boolean;
  /** object URL built from received PREVIEW_DATA bytes (receiver side only). */
  url?: string;
  byteLength?: number;
}

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  mime: string;
  ext: string;
  senderId: PeerId;
  senderName: string;
  /** Stable per-device id — survives page reloads (senderId doesn't), so the
   * sender can still remove their file after reconnecting. */
  senderDeviceId?: string;
  addedAt: number;
  /** peerIds known to hold full bytes. Host maintains; guests receive via POOL_UPDATE. */
  holders: PeerId[];
  /** computed locally vs the save-folder index (name + size match). */
  localState: LocalFileState;
  preview: PreviewInfo;
}

// ── Transfers ─────────────────────────────────────────────────────────────────

export type TransferState =
  | 'queued'
  | 'requesting'
  | 'transferring'
  | 'paused'
  | 'done'
  | 'failed'
  | 'canceled';

export type TransferDirection = 'send' | 'receive';

export type TransferKey = `${string}:${string}:${'send' | 'receive'}`;

export interface Transfer {
  key: TransferKey;
  fileId: string;
  fileName: string;
  direction: TransferDirection;
  remotePeerId: PeerId;
  state: TransferState;
  bytesDone: number;
  bytesTotal: number;
  rateBps: number;
  etaSec: number;
  error?: string;
}

// ── Wire protocol ─────────────────────────────────────────────────────────────

/** Envelope for everything on the 'ctl' Trystero action. */
export interface CtrlMessage<T extends MsgType = MsgType> {
  type: T;
  payload: unknown;
}

export type MsgType =
  | 'HELLO'
  | 'POOL_MANIFEST'
  | 'POOL_UPDATE'
  | 'FILE_ADDED'
  | 'FILE_REMOVED'
  | 'HAVE_REPORT'
  | 'PREVIEW_REQ'
  | 'DOWNLOAD_REQ'
  | 'TRANSFER_OFFER'
  | 'TRANSFER_ACCEPT'
  | 'TRANSFER_REJECT'
  | 'CHUNK_ACK'
  | 'CHUNK_NAK'
  | 'PAUSE'
  | 'RESUME'
  | 'CANCEL'
  | 'TRANSFER_COMPLETE'
  | 'HOST_PING'
  | 'HOST_RELOADING';

export interface HelloPayload {
  peerId: PeerId;
  name: string;
}

export interface PoolManifestPayload {
  version: number;
  /** FileEntry WITHOUT preview bytes — previews are fetched lazily. */
  entries: FileEntry[];
  hostId: PeerId;
}

export interface PoolUpdatePayload {
  version: number;
  added: FileEntry[];
  removedIds: string[];
}

export interface FileAddedPayload {
  entry: FileEntry;
}

export interface FileRemovedPayload {
  fileId: string;
}

export interface HaveReportPayload {
  fileIds: string[];
}

export interface PreviewReqPayload {
  fileId: string;
}

export interface TransferOfferPayload {
  fileId: string;
  name: string;
  size: number;
  chunkSize: number;
}

export interface TransferAcceptPayload {
  fileId: string;
  /** receiver already holds bytes [0, resumeIndex) — sender resumes from there. */
  resumeIndex: number;
}

export interface TransferRejectPayload {
  fileId: string;
  reason?: string;
}

export interface ChunkAckPayload {
  fileId: string;
  /** cumulative: all chunks in [0, ackThrough] are durably written. */
  ackThrough: number;
}

export interface ChunkNakPayload {
  fileId: string;
  index: number;
}

export interface FileOpPayload {
  fileId: string;
}

export interface TransferCompletePayload {
  fileId: string;
  bytes: number;
  sha256?: string;
}

// ── Binary frames ('bin' Trystero action) ─────────────────────────────────────

export const BIN_HEADER_SIZE = 24; // 16B uuid + 4B chunk index + 4B CRC32

// Transfer engine — the core of Bifrost. Chunked, resumable, per-peer-queued
// file transfer in BOTH directions over the Trystero data channels.
//
// Flow (identical for Send and Download; only who clicks differs):
//   sender → TRANSFER_OFFER {fileId, name, size, chunkSize}
//   receiver opens a writable (save folder / OPFS), seeks to its persisted
//            resumeIndex → TRANSFER_ACCEPT {resumeIndex}
//   sender streams 256KB chunks ('bin' frames, CRC32'd) bounded by a sliding
//            window of 16 in flight; receiver writes at {position}, ACKs
//            cumulatively every 8 chunks, persists the resume record per ACK
//   PAUSE drains the window (≤4MB) on both sides, RESUME restarts from
//            ackThrough+1 — or from the receiver's resumeIndex after a reload
//   CANCEL deletes the partial file + resume record on the receiver
//   receiver closes the writable → TRANSFER_COMPLETE → both sides 'done'

import {
  ACK_EVERY,
  CHUNK_SIZE,
  PROGRESS_STORE_INTERVAL_MS,
  WINDOW,
} from '../constants';
import { decodeFrame, encodeFrame, toArrayBuffer } from './binframe';
import { transferKey } from '../utils/id';
import { createLogger } from '../utils/logger';
import { clearResume, getResume, setResume } from '../storage/resumeIndex';
import { openWriteTarget, removeFile, rescanDirectory } from '../storage/directoryIndex';
import { getRootDir } from '../storage/fileSystemAccess';
import { recomputeLocalStates } from '../storage/localRegistry';
import { usePoolStore } from '../store/poolStore';
import { useSessionStore } from '../store/sessionStore';
import { useTransferStore } from '../store/transferStore';
import type { Transport } from './transport';
import type {
  ChunkAckPayload,
  FileOpPayload,
  PeerId,
  TransferAcceptPayload,
  TransferKey,
  TransferOfferPayload,
  TransferRejectPayload,
  TransferCompletePayload,
} from '../types';

const log = createLogger('engine');

const OFFER_TIMEOUT_MS = 60_000;
const ACK_STALL_TIMEOUT_MS = 30_000;
const PAUSE_QUIESCENCE_MS = 2_000;
const COMPLETE_TIMEOUT_MS = 60_000;

interface SenderState {
  key: TransferKey;
  fileId: string;
  name: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  file: File;
  peerId: PeerId;
  /** highest index sent (exclusive) */
  lastSentIndex: number;
  /** cumulative: receiver durably holds [0, ackThrough] */
  ackThrough: number;
  paused: boolean;
  canceled: boolean;
  /** final completion awaited */
  completed: boolean;
  /** a runSendLoop is currently active for this state */
  sending: boolean;
  ackWaiters: Set<() => void>;
  rate: RateTracker;
}

interface ReceiverState {
  key: TransferKey;
  fileId: string;
  name: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  peerId: PeerId;
  writable: FileSystemWritableFileStream;
  /** all chunks in [0, contiguousThrough] written; set holds out-of-order ones above */
  contiguousThrough: number;
  receivedAbove: Set<number>;
  chunksSinceAck: number;
  paused: boolean;
  canceled: boolean;
  finished: boolean;
  pauseTimer: ReturnType<typeof setTimeout> | null;
  rate: RateTracker;
}

/** Sliding-window rate (bytes/s) over the last ~5s. */
class RateTracker {
  private samples: Array<{ t: number; bytes: number }> = [];
  private lastBytes = 0;

  add(bytes: number): void {
    const delta = bytes - this.lastBytes;
    this.lastBytes = bytes;
    if (delta <= 0) return;
    const now = Date.now();
    this.samples.push({ t: now, bytes: delta });
    while (this.samples.length > 0 && now - this.samples[0].t > 5_000) {
      this.samples.shift();
    }
  }

  rate(): number {
    const now = Date.now();
    while (this.samples.length > 0 && now - this.samples[0].t > 5_000) {
      this.samples.shift();
    }
    const span = this.samples.length > 1 ? now - this.samples[0].t : 1_000;
    const total = this.samples.reduce((s, x) => s + x.bytes, 0);
    return span > 0 ? (total / Math.max(span, 250)) * 1000 : 0;
  }
}

export interface EngineDeps {
  transport: Transport;
  /** Resolve the local bytes for a file (local File registry or save folder). */
  fileResolver: (fileId: string, name: string) => Promise<File | null>;
  /** True when receiving is possible (folder granted / OPFS available). */
  canReceive: () => boolean;
}

export class TransferEngine {
  private senders = new Map<TransferKey, SenderState>();
  private receivers = new Map<TransferKey, ReceiverState>();

  constructor(private deps: EngineDeps) {}

  // ── Public API (UI) ────────────────────────────────────────────────────────

  /** Send a local file to a specific peer (Send button / Send All). */
  sendFile(fileId: string, peerId: PeerId, file: File, name?: string): void {
    const key = transferKey(fileId, peerId, 'send');
    if (this.senders.has(key)) return;
    log.info(`Queue send "${name ?? file.name}" (${file.size} B) to ${peerId}`);
    useTransferStore.getState().upsert(fileId, peerId, 'send', {
      fileName: name ?? file.name,
      bytesTotal: file.size,
      state: 'queued',
    });
    useTransferStore.getState().enqueue(peerId, key);
    this.pumpSendQueue(peerId);
  }

  pauseTransfer(key: TransferKey): void {
    const sender = this.senders.get(key);
    if (sender) {
      sender.paused = true;
      useTransferStore.getState().setState(key, sender.ackThrough >= sender.lastSentIndex ? 'paused' : 'transferring');
      this.deps.transport.sendCtrl({ type: 'PAUSE', payload: { fileId: sender.fileId } satisfies FileOpPayload }, sender.peerId);
      return;
    }
    const receiver = this.receivers.get(key);
    if (receiver && !receiver.finished) {
      receiver.paused = true;
      this.deps.transport.sendCtrl({ type: 'PAUSE', payload: { fileId: receiver.fileId } satisfies FileOpPayload }, receiver.peerId);
      this.armPauseQuiescence(receiver);
    }
  }

  resumeTransfer(key: TransferKey): void {
    const sender = this.senders.get(key);
    if (sender && sender.paused) {
      sender.paused = false;
      useTransferStore.getState().setState(key, 'transferring');
      this.notifyAckWaiters(sender);
      // The paused loop already exited (window drained) — restart it.
      if (!sender.sending) void this.runSendLoop(sender);
      // Sender-initiated resume: tell the receiver to flip back to transferring.
      this.deps.transport.sendCtrl({ type: 'RESUME', payload: { fileId: sender.fileId } satisfies FileOpPayload }, sender.peerId);
      return;
    }
    const receiver = this.receivers.get(key);
    if (receiver && receiver.paused && !receiver.finished) {
      receiver.paused = false;
      if (receiver.pauseTimer) clearTimeout(receiver.pauseTimer);
      useTransferStore.getState().setState(key, 'transferring');
      // Receiver-initiated resume: a fresh ACCEPT carries our resume point.
      this.deps.transport.sendCtrl(
        {
          type: 'TRANSFER_ACCEPT',
          payload: { fileId: receiver.fileId, resumeIndex: receiver.contiguousThrough + 1 } satisfies TransferAcceptPayload,
        },
        receiver.peerId
      );
    }
  }

  cancelTransfer(key: TransferKey): void {
    const sender = this.senders.get(key);
    if (sender) {
      sender.canceled = true;
      this.notifyAckWaiters(sender);
      this.deps.transport.sendCtrl({ type: 'CANCEL', payload: { fileId: sender.fileId } satisfies FileOpPayload }, sender.peerId);
      this.finishSender(key, 'canceled');
      return;
    }
    const receiver = this.receivers.get(key);
    if (receiver) {
      receiver.canceled = true;
      this.deps.transport.sendCtrl({ type: 'CANCEL', payload: { fileId: receiver.fileId } satisfies FileOpPayload }, receiver.peerId);
      this.finishReceiver(key, 'canceled');
    }
  }

  /** Peer went away — fail its active + queued transfers. */
  peerLeft(peerId: PeerId): void {
    for (const [key, s] of this.senders) {
      if (s.peerId === peerId) {
        s.canceled = true;
        this.notifyAckWaiters(s);
        this.finishSender(key, 'failed', 'peer disconnected');
      }
    }
    for (const [key, r] of this.receivers) {
      if (r.peerId === peerId) {
        r.canceled = true;
        this.finishReceiver(key, 'failed', 'peer disconnected');
      }
    }
    useTransferStore.setState((s) => {
      const transfers = { ...s.transfers };
      for (const t of Object.values(transfers)) {
        if (t.remotePeerId === peerId && (t.state === 'queued' || t.state === 'requesting')) {
          transfers[t.key] = { ...t, state: 'failed', error: 'peer disconnected' };
        }
      }
      return { transfers, queues: { ...s.queues, [peerId]: [] } };
    });
  }

  // ── Send queue ─────────────────────────────────────────────────────────────

  private pumpSendQueue(peerId: PeerId): void {
    for (const s of this.senders.values()) {
      if (s.peerId === peerId) return; // one active send per peer
    }
    const store = useTransferStore.getState();
    const key = store.dequeue(peerId);
    if (!key) return;
    const t = store.transfers[key];
    if (!t || t.state !== 'queued') {
      this.pumpSendQueue(peerId); // skip stale entries
      return;
    }
    void this.startSender(t.fileId, t.fileName, peerId, key);
  }

  private async startSender(
    fileId: string,
    name: string,
    peerId: PeerId,
    key: TransferKey
  ): Promise<void> {
    const file = await this.deps.fileResolver(fileId, name);
    if (!file) {
      log.warn(`Sender: local bytes for "${name}" not found — failing transfer`);
      useTransferStore.getState().setState(key, 'failed', 'local file not found');
      this.pumpSendQueue(peerId);
      return;
    }
    const state: SenderState = {
      key,
      fileId,
      name,
      size: file.size,
      chunkSize: CHUNK_SIZE,
      totalChunks: Math.max(1, Math.ceil(file.size / CHUNK_SIZE)),
      file,
      peerId,
      lastSentIndex: 0,
      ackThrough: -1,
      paused: false,
      canceled: false,
      completed: false,
      sending: false,
      ackWaiters: new Set(),
      rate: new RateTracker(),
    };
    this.senders.set(key, state);
    useTransferStore.getState().setState(key, 'requesting');
    useTransferStore.getState().upsert(fileId, peerId, 'send', {
      fileName: name,
      bytesTotal: file.size,
    });

    const offer = {
      type: 'TRANSFER_OFFER',
      payload: { fileId, name, size: file.size, chunkSize: CHUNK_SIZE } satisfies TransferOfferPayload,
    } as const;
    this.deps.transport.sendCtrl(offer, peerId);

    // Offer can die silently (peer mid-leave) — bound the wait.
    setTimeout(() => {
      const s = this.senders.get(key);
      if (s && s.lastSentIndex === 0 && s.ackThrough < 0) {
        this.finishSender(key, 'failed', 'no response to transfer offer');
        this.pumpSendQueue(peerId);
      }
    }, OFFER_TIMEOUT_MS);
  }

  private async runSendLoop(state: SenderState): Promise<void> {
    if (state.sending) return; // a loop is already driving this transfer
    state.sending = true;
    const store = useTransferStore.getState();
    try {      while (!state.canceled && !state.completed && state.lastSentIndex < state.totalChunks) {
        if (state.paused) {
          if (state.lastSentIndex - 1 <= state.ackThrough) {
            // Window drained — settle into paused.
            store.setState(state.key, 'paused');
            return; // resume re-invokes via TRANSFER_ACCEPT / RESUME
          }
          await this.waitForAck(state);
          continue;
        }
        if (state.lastSentIndex - state.ackThrough >= WINDOW) {
          const ok = await this.waitForAck(state, ACK_STALL_TIMEOUT_MS);
          if (!ok) {
            if (!state.canceled) {
              this.finishSender(state.key, 'failed', 'transfer stalled (no ACKs)');
              this.pumpSendQueue(state.peerId);
            }
            return;
          }
          continue;
        }
        const i = state.lastSentIndex;
        const start = i * state.chunkSize;
        const blob = state.file.slice(start, Math.min(start + state.chunkSize, state.size));
        const buf = new Uint8Array(await blob.arrayBuffer());
        if (state.canceled) return;
        this.deps.transport.sendBin(encodeFrame(state.fileId, i, buf), state.peerId);
        state.lastSentIndex++;
      }

      if (state.canceled || state.completed) return;

      // All chunks sent — wait for the receiver's TRANSFER_COMPLETE.
      const deadline = Date.now() + COMPLETE_TIMEOUT_MS;
      while (!state.completed && !state.canceled && Date.now() < deadline) {
        if (state.ackThrough >= state.totalChunks - 1) {
          await sleep(200);
        } else {
          const ok = await this.waitForAck(state, ACK_STALL_TIMEOUT_MS);
          if (!ok && !state.canceled) {
            this.finishSender(state.key, 'failed', 'transfer stalled at tail');
            this.pumpSendQueue(state.peerId);
            return;
          }
        }
      }
      // TRANSFER_COMPLETE handler finalizes; timeout here just gives up quietly
      // if the completion message was lost after a fully-acked transfer.
      const s = this.senders.get(state.key);
      if (s && !s.completed && !s.canceled && s.ackThrough >= s.totalChunks - 1) {
        this.finishSender(state.key, 'done');
        this.pumpSendQueue(state.peerId);
      }
    } catch (e) {
      log.error('send loop threw:', e);
      if (!state.canceled) {
        this.finishSender(state.key, 'failed', String(e));
        this.pumpSendQueue(state.peerId);
      }
    } finally {
      state.sending = false;
    }
  }

  private waitForAck(state: SenderState, timeoutMs?: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const waiter = () => {
        if (done) return;
        done = true;
        state.ackWaiters.delete(waiter);
        if (timeout) clearTimeout(timeout);
        resolve(true);
      };
      const timeout = timeoutMs
        ? setTimeout(() => {
            if (done) return;
            done = true;
            state.ackWaiters.delete(waiter);
            resolve(false);
          }, timeoutMs)
        : undefined;
      state.ackWaiters.add(waiter);
    });
  }

  private notifyAckWaiters(state: SenderState): void {
    for (const w of [...state.ackWaiters]) w();
  }

  private finishSender(
    key: TransferKey,
    state: 'done' | 'failed' | 'canceled',
    error?: string
  ): void {
    const s = this.senders.get(key);
    this.senders.delete(key);
    useTransferStore.getState().setState(key, state, error);
    if (s) this.pumpSendQueue(s.peerId);
  }

  // ── Receive queue ──────────────────────────────────────────────────────────

  private pumpReceiveQueue(peerId: PeerId): void {
    for (const r of this.receivers.values()) {
      if (r.peerId === peerId) return; // one active receive per peer
    }
    const store = useTransferStore.getState();
    const key = store.dequeue(peerId);
    if (!key) return;
    const t = store.transfers[key];
    if (!t || t.state !== 'queued') {
      this.pumpReceiveQueue(peerId);
      return;
    }
    void this.startReceiver(t.fileId, t.fileName, t.bytesTotal, peerId, key);
  }

  private async startReceiver(
    fileId: string,
    name: string,
    size: number,
    peerId: PeerId,
    key: TransferKey
  ): Promise<void> {
    useTransferStore.getState().setState(key, 'requesting');
    if (!this.deps.canReceive()) {
      this.deps.transport.sendCtrl(
        { type: 'TRANSFER_REJECT', payload: { fileId, reason: 'no storage access' } satisfies TransferRejectPayload },
        peerId
      );
      useTransferStore.getState().setState(key, 'failed', 'no storage access — pick a save folder');
      this.pumpReceiveQueue(peerId);
      return;
    }

    // Cross-reload resume: a previous attempt may have left bytes on disk.
    const rec = await getResume(fileId);
    const resumable =
      rec && rec.fileName === name && rec.nextIndex > 0 ? rec : null;
    const resumeIndex = resumable?.nextIndex ?? 0;

    let writable: FileSystemWritableFileStream | null = null;
    try {
      if (resumable) {
        // Reopen the existing partial — keepExistingData + seek to resume point.
        const root = await getRootDir();
        if (root) {
          const handle = await root.getFileHandle(resumable.fileName, { create: true });
          writable = await handle.createWritable({ keepExistingData: true });
          await writable.seek(resumeIndex * CHUNK_SIZE);
        }
      }
      if (!writable) {
        const target = await openWriteTarget(name);
        if (!target) throw new Error('cannot open write target');
        writable = target.writable;
        if (target.finalName !== name) name = target.finalName;
      }
    } catch (e) {
      log.error('open write target failed:', e);
      useTransferStore.getState().setState(key, 'failed', 'cannot write to save folder');
      this.pumpReceiveQueue(peerId);
      return;
    }
    if (!writable) {
      useTransferStore.getState().setState(key, 'failed', 'cannot write to save folder');
      this.pumpReceiveQueue(peerId);
      return;
    }

    const chunkSize = CHUNK_SIZE;
    const state: ReceiverState = {
      key,
      fileId,
      name,
      size,
      chunkSize,
      totalChunks: Math.max(1, Math.ceil(size / chunkSize)),
      peerId,
      writable,
      contiguousThrough: resumeIndex - 1,
      receivedAbove: new Set(),
      chunksSinceAck: 0,
      paused: false,
      canceled: false,
      finished: false,
      pauseTimer: null,
      rate: new RateTracker(),
    };
    this.receivers.set(key, state);
    log.info(
      `Receiver: accepting "${name}" from ${peerId} — resumeIndex ${resumeIndex}, ${state.totalChunks} chunks expected`
    );
    useTransferStore.getState().setState(key, 'transferring');

    this.deps.transport.sendCtrl(
      { type: 'TRANSFER_ACCEPT', payload: { fileId, resumeIndex } satisfies TransferAcceptPayload },
      peerId
    );
  }

  private advanceContiguous(state: ReceiverState): void {
    while (state.receivedAbove.has(state.contiguousThrough + 1)) {
      state.contiguousThrough++;
      state.receivedAbove.delete(state.contiguousThrough);
    }
  }

  private async maybeAck(state: ReceiverState, force = false): Promise<void> {
    if (!force && state.chunksSinceAck < ACK_EVERY) return;
    if (state.chunksSinceAck === 0 && !force) return;
    state.chunksSinceAck = 0;
    this.deps.transport.sendCtrl(
      {
        type: 'CHUNK_ACK',
        payload: { fileId: state.fileId, ackThrough: state.contiguousThrough } satisfies ChunkAckPayload,
      },
      state.peerId
    );
    // Persist resume state at the same cadence as ACKs — reload-safe.
    try {
      await setResume({
        fileId: state.fileId,
        fileName: state.name,
        nextIndex: state.contiguousThrough + 1,
        chunkSize: state.chunkSize,
      });
    } catch (e) {
      log.warn('resume persist failed:', e);
    }
  }

  private async handleChunkData(frame: { fileId: string; index: number; payload: Uint8Array }, from: PeerId): Promise<void> {
    const state = [...this.receivers.values()].find(
      (r) => r.fileId === frame.fileId && r.peerId === from
    );
    if (!state || state.finished || state.canceled) return;

    // First chunk of the transfer — visible proof the pipe is flowing.
    if (state.contiguousThrough < 0 && frame.index === 0) {
      log.info(`Receiver: first chunk of "${state.name}" arrived from ${from}`);
    }

    try {
      await state.writable.write({
        type: 'write',
        position: frame.index * state.chunkSize,
        data: toArrayBuffer(frame.payload),
      });
    } catch (e) {
      log.error('disk write failed:', e);
      this.finishReceiver(state.key, 'failed', 'disk write failed');
      return;
    }

    if (frame.index === state.contiguousThrough + 1) {
      state.contiguousThrough = frame.index;
      this.advanceContiguous(state);
    } else if (frame.index > state.contiguousThrough) {
      state.receivedAbove.add(frame.index);
    }
    state.chunksSinceAck++;
    state.rate.add((state.contiguousThrough + 1) * state.chunkSize);
    this.pushProgress(state.key, (state.contiguousThrough + 1) * state.chunkSize, state.size, state.rate);

    if (state.paused) {
      this.armPauseQuiescence(state);
      await this.maybeAck(state, true);
      return;
    }

    if (state.contiguousThrough >= state.totalChunks - 1) {
      await this.completeReceive(state);
      return;
    }
    await this.maybeAck(state);
  }

  private async completeReceive(state: ReceiverState): Promise<void> {
    state.finished = true;
    log.info(`Receiver: "${state.name}" complete (${state.size} B) — closing file`);
    try {
      await state.writable.close();
      await clearResume(state.fileId);
      await rescanDirectory();
      recomputeLocalStates(); // the file is now on this device — flip the badge
    } catch (e) {
      log.error('finalize receive failed:', e);
      this.finishReceiver(state.key, 'failed', 'finalize failed');
      return;
    }
    this.deps.transport.sendCtrl(
      {
        type: 'TRANSFER_COMPLETE',
        payload: { fileId: state.fileId, bytes: state.size } satisfies TransferCompletePayload,
      },
      state.peerId
    );
    this.finishReceiver(state.key, 'done');
  }

  /** While paused, keep ACKing in-flight chunks; settle when they stop arriving. */
  private armPauseQuiescence(state: ReceiverState): void {
    if (state.pauseTimer) clearTimeout(state.pauseTimer);
    state.pauseTimer = setTimeout(() => {
      state.pauseTimer = null;
      if (state.paused && !state.finished && !state.canceled) {
        useTransferStore.getState().setState(state.key, 'paused');
      }
    }, PAUSE_QUIESCENCE_MS);
  }

  private finishReceiver(
    key: TransferKey,
    state: 'done' | 'failed' | 'canceled',
    error?: string
  ): void {
    const r = this.receivers.get(key);
    this.receivers.delete(key);
    if (r) {
      if (r.pauseTimer) clearTimeout(r.pauseTimer);
      if (state === 'canceled' || state === 'failed') {
        // Partial file + resume record are garbage — clean up best-effort.
        void r.writable
          .close()
          .catch(() => undefined)
          .then(() => removeFile(r.name))
          .then(() => clearResume(r.fileId))
          .then(() => rescanDirectory())
          .catch(() => undefined);
      }
      this.pumpReceiveQueue(r.peerId);
    }
    useTransferStore.getState().setState(key, state, error);
  }

  // ── Progress → store (throttled) ───────────────────────────────────────────

  private lastPush = new Map<TransferKey, number>();

  private pushProgress(
    key: TransferKey,
    bytesDone: number,
    bytesTotal: number,
    rate: RateTracker
  ): void {
    const now = Date.now();
    const last = this.lastPush.get(key) ?? 0;
    if (now - last < PROGRESS_STORE_INTERVAL_MS) return;
    this.lastPush.set(key, now);
    const r = rate.rate();
    const remaining = Math.max(0, bytesTotal - bytesDone);
    useTransferStore.getState().progress(key, bytesDone, r, r > 0 ? remaining / r : 0);
  }

  // ── Protocol handlers (called by sessionController) ────────────────────────

  handleOffer(payload: unknown, from: PeerId): void {
    const p = payload as TransferOfferPayload;
    if (!p?.fileId || typeof p.size !== 'number') return;
    log.info(`Receiver: OFFER "${p.name}" (${p.size} B) from ${from}`);
    const key = transferKey(p.fileId, from, 'receive');
    if (this.receivers.has(key)) return;
    useTransferStore.getState().upsert(p.fileId, from, 'receive', {
      fileName: p.name,
      bytesTotal: p.size,
      state: 'queued',
    });
    useTransferStore.getState().enqueue(from, key);
    this.pumpReceiveQueue(from);
  }

  handleAccept(payload: unknown, from: PeerId): void {
    const p = payload as TransferAcceptPayload;
    if (!p?.fileId || typeof p.resumeIndex !== 'number') return;
    const key = transferKey(p.fileId, from, 'send');
    const state = this.senders.get(key);
    if (!state) return; // not ours / stale
    if (state.lastSentIndex === 0 && state.ackThrough < 0) {
      // Fresh start.
      state.ackThrough = p.resumeIndex - 1;
      state.lastSentIndex = p.resumeIndex;
    } else {
      // Resume after pause: receiver dictates the restart point.
      state.ackThrough = p.resumeIndex - 1;
      state.lastSentIndex = Math.max(state.lastSentIndex, p.resumeIndex);
      state.paused = false;
    }
    log.info(
      `Sender: ACCEPT for "${state.name}" from ${from} — resumeIndex ${p.resumeIndex}, sending from chunk ${state.lastSentIndex}/${state.totalChunks}`
    );
    useTransferStore.getState().setState(key, 'transferring');
    if (state.lastSentIndex < state.totalChunks) {
      void this.runSendLoop(state);
    }
  }

  handleReject(payload: unknown, from: PeerId): void {
    const p = payload as TransferRejectPayload;
    if (!p?.fileId) return;
    const key = transferKey(p.fileId, from, 'send');
    if (!this.senders.has(key)) return;
    this.finishSender(key, 'failed', p.reason ?? 'rejected by receiver');
    this.pumpSendQueue(from);
  }

  handleAck(payload: unknown, from: PeerId): void {
    const p = payload as ChunkAckPayload;
    if (!p?.fileId || typeof p.ackThrough !== 'number') return;
    const key = transferKey(p.fileId, from, 'send');
    const state = this.senders.get(key);
    if (!state) return;
    if (p.ackThrough > state.ackThrough) {
      state.ackThrough = p.ackThrough;
      state.rate.add((state.ackThrough + 1) * state.chunkSize);
      this.pushProgress(state.key, (state.ackThrough + 1) * state.chunkSize, state.size, state.rate);
      this.notifyAckWaiters(state);
    }
  }

  handleNak(payload: unknown, from: PeerId): void {
    const p = payload as { fileId: string; index: number };
    if (!p?.fileId || typeof p.index !== 'number') return;
    const key = transferKey(p.fileId, from, 'send');
    const state = this.senders.get(key);
    if (!state || p.index >= state.lastSentIndex) return;
    void state.file
      .slice(p.index * state.chunkSize, (p.index + 1) * state.chunkSize)
      .arrayBuffer()
      .then((buf) => {
        if (state.canceled) return;
        this.deps.transport.sendBin(
          encodeFrame(state.fileId, p.index, new Uint8Array(buf)),
          state.peerId
        );
      });
  }

  handlePause(payload: unknown, from: PeerId): void {
    const p = payload as FileOpPayload;
    if (!p?.fileId) return;
    const sKey = transferKey(p.fileId, from, 'send');
    const sender = this.senders.get(sKey);
    if (sender) {
      sender.paused = true;
      this.notifyAckWaiters(sender);
      return;
    }
    const rKey = transferKey(p.fileId, from, 'receive');
    const receiver = this.receivers.get(rKey);
    if (receiver && !receiver.finished) {
      receiver.paused = true;
      this.armPauseQuiescence(receiver);
    }
  }

  handleResume(payload: unknown, from: PeerId): void {
    const p = payload as FileOpPayload;
    if (!p?.fileId) return;
    const rKey = transferKey(p.fileId, from, 'receive');
    const receiver = this.receivers.get(rKey);
    if (receiver && receiver.paused && !receiver.finished) {
      receiver.paused = false;
      if (receiver.pauseTimer) clearTimeout(receiver.pauseTimer);
      useTransferStore.getState().setState(rKey, 'transferring');
    }
  }

  handleCancel(payload: unknown, from: PeerId): void {
    const p = payload as FileOpPayload;
    if (!p?.fileId) return;
    const sKey = transferKey(p.fileId, from, 'send');
    if (this.senders.has(sKey)) {
      this.finishSender(sKey, 'canceled');
      this.pumpSendQueue(from);
      return;
    }
    const rKey = transferKey(p.fileId, from, 'receive');
    if (this.receivers.has(rKey)) {
      this.finishReceiver(rKey, 'canceled');
    }
  }

  handleComplete(payload: unknown, from: PeerId): void {
    const p = payload as TransferCompletePayload;
    if (!p?.fileId) return;
    const key = transferKey(p.fileId, from, 'send');
    const state = this.senders.get(key);
    if (!state) return;
    state.completed = true;
    this.notifyAckWaiters(state);
    // Host-side completion: the host now holds full bytes → update holders.
    const pool = usePoolStore.getState();
    const entry = pool.files[p.fileId];
    if (entry && !entry.holders.includes(this.selfId())) {
      pool.setHolders(p.fileId, [...entry.holders, this.selfId()]);
    }
    this.finishSender(key, 'done');
    this.pumpSendQueue(from);
  }

  handleBinData(data: unknown, from: PeerId): void {
    // Trystero delivers binary payloads as Uint8Array (not ArrayBuffer).
    if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) return;
    const frame = decodeFrame(data);
    if (!frame) return; // truncated — unrecoverable
    if (!frame.crcOk) {
      // Corrupt chunk in flight → ask for a resend of exactly this index.
      log.warn(`Receiver: CRC mismatch on chunk ${frame.index} of ${frame.fileId} — NAK`);
      this.deps.transport.sendCtrl(
        { type: 'CHUNK_NAK', payload: { fileId: frame.fileId, index: frame.index } },
        from
      );
      return;
    }
    void this.handleChunkData(frame, from);
  }

  private selfId(): string {
    return useSessionStore.getState().selfId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

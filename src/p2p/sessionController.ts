// Session controller — owns the room lifecycle and wires transport + protocol
// dispatcher + transfer engine + stores together. One singleton per page.
//
// Handshake (guest): waitForFirstPeer (tracker discovery can take 80s) →
// HELLO retried every 1.5s (a HELLO sent before the peer-join is silently
// lost) → host replies POOL_MANIFEST (completes the handshake) → guest
// reports HAVE_REPORT + lazily fetches previews.
// Liveness: host pings every 10s; guest watchdog 45s of silence → reconnect
// loop (max 12 attempts / 3min). Host announces HOST_RELOADING on pagehide.

import {
  DISCOVERY_TIMEOUT,
  HELLO_MAX_RETRIES,
  HELLO_RETRY_MS,
  HOST_ROOM_KEY,
  PING_MS,
  RECONNECT_INTERVAL_MS,
  RECONNECT_MAX_ATTEMPTS,
  WATCHDOG_MS,
  PEER_NAME_KEY,
} from '../constants';
import { generateRoomId, buildInviteLink } from '../utils/inviteLink';
import { uuid } from '../utils/id';
import { createLogger } from '../utils/logger';
import { decodeFrame, encodeFrame, toArrayBuffer } from './binframe';
import { createProtocolHandler, type ProtocolDeps } from './protocol';
import { TransferEngine } from './transferEngine';
import { getTransport } from './trysteroTransport';
import { usePoolStore } from '../store/poolStore';
import { useSessionStore } from '../store/sessionStore';
import { useTransferStore } from '../store/transferStore';
import { rescanDirectory, hasFile, findHandle } from '../storage/directoryIndex';
import { canWrite } from '../storage/fileSystemAccess';
import {
  computeLocalState,
  getLocalFile,
  registerLocalFile,
  recomputeLocalStates,
} from '../storage/localRegistry';
import { generatePreview } from '../preview/generatePreview';
import type { FileEntry, PeerId } from '../types';

const log = createLogger('session');

/** Preview bytes we hold — every peer accumulates these so any of them can serve PREVIEW_REQ. */
const previewBytes = new Map<string, Uint8Array>();

class SessionController {
  readonly engine: TransferEngine;
  private transport = getTransport();

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastHostSeen = 0;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private helloAttempts = 0;
  private handshakeDone = false;

  private reconnect = { active: false, attempts: 0, timer: null as ReturnType<typeof setTimeout> | null };
  private pendingRoomId: string | null = null;
  private offFns: Array<() => void> = [];
  private role: 'host' | 'guest' | null = null;

  constructor() {
    this.engine = new TransferEngine({
      transport: this.transport,
      fileResolver: (fileId, name) => this.resolveLocalFile(fileId, name),
      canReceive: () => this.canReceive(),
    });
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  private selfId(): string {
    let id = localStorage.getItem('bifrost-self-id');
    if (!id) {
      id = uuid();
      localStorage.setItem('bifrost-self-id', id);
    }
    return id;
  }

  selfName(): string {
    return localStorage.getItem(PEER_NAME_KEY) ?? '';
  }

  setSelfName(name: string): void {
    localStorage.setItem(PEER_NAME_KEY, name);
    useSessionStore.getState().setSelf(this.selfId(), name);
  }

  // ── Host ───────────────────────────────────────────────────────────────────

  async connectAsHost(): Promise<void> {
    const store = useSessionStore.getState();
    const selfId = this.selfId();
    const name = this.selfName();
    store.setSelf(selfId, name);

    // Host identity survives refresh via a dedicated key — a same-browser
    // guest tab must not be able to clobber it (sessionResume gotcha).
    let roomId = localStorage.getItem(HOST_ROOM_KEY);
    if (!roomId) {
      roomId = generateRoomId();
      localStorage.setItem(HOST_ROOM_KEY, roomId);
    }

    store.setStatus('connecting', 'Creating room…');
    this.role = 'host';
    try {
      await this.attach(roomId);
    } catch (e) {
      store.setStatus('failed', String(e));
      return;
    }
    const link = buildInviteLink(roomId);
    store.setRoom(roomId, link);
    store.setStatus('connected');
    this.startPing();
    void rescanDirectory();
    log.info('Hosting room', roomId);
  }

  // ── Guest ──────────────────────────────────────────────────────────────────

  async joinAsGuest(roomId: string, name: string): Promise<void> {
    const store = useSessionStore.getState();
    store.setSelf(this.selfId(), name);
    this.pendingRoomId = roomId;
    this.role = 'guest';

    await this.guestAttach(roomId, name, { rejoin: false });
  }

  private async guestAttach(
    roomId: string,
    name: string,
    opts: { rejoin: boolean }
  ): Promise<void> {
    const store = useSessionStore.getState();
    store.setStatus(opts.rejoin ? 'reconnecting' : 'connecting', 'Joining room…');

    try {
      await this.attach(roomId);
    } catch (e) {
      store.setStatus('failed', String(e));
      return;
    }

    if (!opts.rejoin) {
      store.setStatus('connecting', 'Looking for the host — this can take up to 80 seconds…');
    }
    const found = await this.transport.waitForFirstPeer(DISCOVERY_TIMEOUT);
    if (useSessionStore.getState().status !== 'connecting' && useSessionStore.getState().status !== 'reconnecting') {
      return; // torn down meanwhile
    }
    if (!found) {
      if (opts.rejoin) {
        // Keep 'reconnecting' so the reconnect loop schedules its next attempt.
        return;
      }
      store.setStatus('failed', 'Could not find the host — check the link and try again');
      return;
    }

    // HELLO retry until the manifest lands (first HELLO can be lost if it
    // races the peer-join on the host side).
    this.handshakeDone = false;
    this.helloAttempts = 0;
    const sendHello = () => {
      this.transport.sendCtrl(
        { type: 'HELLO', payload: { peerId: this.selfId(), name } },
        this.hostPeerId() ?? undefined
      );
    };
    sendHello();
    this.helloTimer = setInterval(() => {
      this.helloAttempts++;
      if (this.helloAttempts > HELLO_MAX_RETRIES || this.handshakeDone) {
        if (this.helloTimer) clearInterval(this.helloTimer);
        this.helloTimer = null;
        if (!this.handshakeDone) {
          useSessionStore.getState().setStatus('failed', 'The host did not respond');
        }
        return;
      }
      sendHello();
    }, HELLO_RETRY_MS);

    this.startWatchdog();
  }

  private hostPeerId(): PeerId | null {
    // In a 1-host room any peer that isn't us and answers is the host; we
    // track the id once the manifest arrives (authoritative hostId).
    const room = useSessionStore.getState();
    for (const id of Object.keys(room.peers)) {
      if (room.peers[id].isHost) return id;
    }
    return this.firstPeerId();
  }

  private firstPeerId(): PeerId | null {
    const ids = this.transport.getPeerIds().filter((id) => id !== this.selfId());
    return ids[0] ?? null;
  }

  // ── Shared attach/teardown ─────────────────────────────────────────────────

  private async attach(roomId: string): Promise<void> {
    for (const off of this.offFns) off();
    this.offFns = [];

    if (this.role === 'guest') {
      await this.transport.leave();
    }

    if (this.role === 'host') {
      await this.transport.hostRoom(roomId);
    } else {
      await this.transport.joinAsGuest(roomId);
    }

    const handler = createProtocolHandler(this.protocolDeps());
    this.offFns.push(
      this.transport.onCtrl((msg, from) => {
        this.lastHostSeen = Date.now();
        handler(msg, from);
      }),
      this.transport.onBin((data, from) => this.engine.handleBinData(data, from)),
      this.transport.onPreview((data, from) => this.handlePreviewData(data, from)),
      this.transport.onPeerJoin((peerId) => this.handlePeerJoin(peerId)),
      this.transport.onPeerLeave((peerId) => this.handlePeerLeave(peerId))
    );
  }

  private handlePeerJoin(peerId: PeerId): void {
    const store = useSessionStore.getState();
    if (peerId === store.selfId) return;
    store.upsertPeer({
      id: peerId,
      name: '…',
      isHost: false,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    });
    if (this.role === 'host') {
      // Backup manifest push — the reply to HELLO can race with the peer's
      // receive pipeline settling (known lesson).
      setTimeout(() => {
        if (this.role === 'host' && this.transport.getPeerIds().includes(peerId)) {
          this.transport.sendCtrl(this.manifestMsg(), peerId);
        }
      }, 1_500);
    }
  }

  private handlePeerLeave(peerId: PeerId): void {
    const store = useSessionStore.getState();
    const peer = store.peers[peerId];
    store.removePeer(peerId);
    this.engine.peerLeft(peerId);
    if (this.role === 'guest' && peer?.isHost) {
      this.startReconnect('The host disconnected');
    }
  }

  leave(): void {
    this.stopTimers();
    if (this.reconnect.timer) clearTimeout(this.reconnect.timer);
    this.reconnect = { active: false, attempts: 0, timer: null };
    this.role = null;
    useSessionStore.getState().reset();
    usePoolStore.getState().reset();
    useTransferStore.getState().reset();
    void this.transport.leave();
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.pingTimer = null;
    this.watchdogTimer = null;
    this.helloTimer = null;
  }

  // ── Heartbeat / watchdog / reconnect ───────────────────────────────────────

  private startPing(): void {
    this.stopTimers();
    this.pingTimer = setInterval(() => {
      this.transport.broadcastCtrl({ type: 'HOST_PING', payload: {} });
    }, PING_MS);
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.lastHostSeen = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (Date.now() - this.lastHostSeen > WATCHDOG_MS) {
        this.startReconnect('Lost connection to the host');
      }
    }, 5_000);
  }

  private startReconnect(reason: string): void {
    if (this.reconnect.active || !this.pendingRoomId) return;
    if (this.role !== 'guest') return;
    this.reconnect = { active: true, attempts: 0, timer: null };
    const store = useSessionStore.getState();
    store.setStatus('reconnecting', reason);

    const attempt = async () => {
      if (!this.reconnect.active) return;
      this.reconnect.attempts++;
      if (this.reconnect.attempts > RECONNECT_MAX_ATTEMPTS) {
        this.reconnect.active = false;
        useSessionStore.getState().setStatus('failed', 'Could not reach the host — use retry to try again');
        return;
      }
      log.info(`Reconnect attempt ${this.reconnect.attempts}/${RECONNECT_MAX_ATTEMPTS}`);
      this.stopTimers();
      try {
        await this.guestAttach(this.pendingRoomId!, this.selfName(), { rejoin: true });
      } catch (e) {
        log.warn('reconnect attempt threw:', e);
      }
      if (this.reconnect.active && useSessionStore.getState().status === 'reconnecting') {
        this.reconnect.timer = setTimeout(attempt, RECONNECT_INTERVAL_MS);
      } else {
        this.reconnect.active = false;
      }
    };
    // First retry comes after the interval, not immediately — the host may
    // simply be mid-refresh.
    this.reconnect.timer = setTimeout(attempt, RECONNECT_INTERVAL_MS);
  }

  retryConnection(): void {
    this.reconnect = { active: false, attempts: 0, timer: null };
    if (this.pendingRoomId) {
      this.role = 'guest';
      void this.guestAttach(this.pendingRoomId, this.selfName(), { rejoin: false });
    }
  }

  /** Host pagehide: announce so guests reconnect immediately instead of waiting out the watchdog. */
  announceReloading(): void {
    if (this.role === 'host') {
      this.transport.broadcastCtrl({ type: 'HOST_RELOADING', payload: {} });
    }
  }

  // ── Pool operations ────────────────────────────────────────────────────────

  /** Add local files to the pool (metadata immediately, preview async). */
  async addFiles(files: File[]): Promise<void> {
    const store = useSessionStore.getState();
    const pool = usePoolStore.getState();
    for (const file of files) {
      const id = uuid();
      const entry: FileEntry = {
        id,
        name: file.name,
        size: file.size,
        mime: file.type || guessMime(file.name),
        ext: extOf(file.name),
        senderId: store.selfId,
        senderName: store.selfName || 'Me',
        addedAt: Date.now(),
        holders: [store.selfId],
        localState: 'local',
        preview: { ready: false },
      };
      registerLocalFile(id, file);

      if (this.role === 'host') {
        pool.addLocal(entry);
        this.broadcastPoolUpdate();
      } else {
        // Optimistic local add; the host echoes an authoritative POOL_UPDATE.
        pool.addLocal(entry);
        this.transport.broadcastCtrl({ type: 'FILE_ADDED', payload: { entry } });
      }

      // Preview generation is best-effort and never blocks the pool.
      void generatePreview(file)
        .then(async (bytes) => {
          if (!bytes) return;
          previewBytes.set(id, bytes);
          const url = URL.createObjectURL(
            new Blob([toArrayBuffer(bytes)], { type: 'image/jpeg' })
          );
          usePoolStore.getState().setPreview(id, url, bytes.length);
          // Push bytes to everyone already in the room; late joiners use PREVIEW_REQ.
          const frame = encodeFrame(id, 0, bytes);
          for (const peer of this.transport.getPeerIds()) {
            if (peer !== store.selfId) this.transport.sendPreview(frame, peer);
          }
        })
        .catch((e) => log.warn(`preview generation failed for ${file.name}:`, e));
    }
  }

  /** Local bytes for a pool entry, if this device still has them. */
  localFileFor(fileId: string): File | null {
    return getLocalFile(fileId);
  }

  /** Send All: push every local file the host doesn't hold yet to the host. */
  sendAllToHost(): void {
    if (this.role !== 'guest') return;
    const hostId = this.hostId();
    if (!hostId) return;
    const pool = usePoolStore.getState();
    for (const entry of Object.values(pool.files)) {
      if (entry.senderId !== useSessionStore.getState().selfId) continue;
      if (entry.holders.includes(hostId)) continue;
      const file = getLocalFile(entry.id);
      if (!file) continue;
      this.engine.sendFile(entry.id, hostId, file, entry.name);
    }
  }

  /** Download: ask the holder (host in v1) to start a transfer to us. */
  downloadFile(fileId: string): void {
    const pool = usePoolStore.getState();
    const entry = pool.files[fileId];
    if (!entry || entry.localState === 'local') return;
    const hostId = this.hostId();
    if (!hostId || !entry.holders.includes(hostId)) return; // UI disables earlier
    this.transport.sendCtrl({ type: 'DOWNLOAD_REQ', payload: { fileId } }, hostId);
  }

  removeFile(fileId: string): void {
    const pool = usePoolStore.getState();
    const entry = pool.files[fileId];
    if (!entry) return;
    const selfId = useSessionStore.getState().selfId;
    const allowed = this.role === 'host' || entry.senderId === selfId;
    if (!allowed) return;
    if (this.role === 'host') {
      pool.removeLocal(fileId);
      this.broadcastPoolUpdate();
    } else {
      this.transport.broadcastCtrl({ type: 'FILE_REMOVED', payload: { fileId } });
    }
  }

  requestPreview(fileId: string): void {
    if (previewBytes.has(fileId)) return;
    const entry = usePoolStore.getState().files[fileId];
    if (!entry?.preview.ready) return;
    const holder = entry.holders.find((h) => h !== useSessionStore.getState().selfId);
    if (holder) {
      this.transport.sendCtrl({ type: 'PREVIEW_REQ', payload: { fileId } }, holder);
    }
  }

  // ── Engine wiring ──────────────────────────────────────────────────────────

  private canReceive(): boolean {
    return canWrite();
  }

  private async resolveLocalFile(fileId: string, name: string): Promise<File | null> {
    const local = getLocalFile(fileId);
    if (local) return local;
    // Host serving downloads from its save folder.
    const entry = usePoolStore.getState().files[fileId];
    const handle = findHandle(name, entry?.size ?? 0);
    if (!handle) return null;
    try {
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  // ── Protocol handlers ──────────────────────────────────────────────────────

  private manifestMsg() {
    const pool = usePoolStore.getState();
    return {
      type: 'POOL_MANIFEST',
      payload: {
        version: pool.manifestVersion,
        entries: Object.values(pool.files),
        hostId: useSessionStore.getState().selfId,
      },
    } as const;
  }

  private broadcastPoolUpdate(added: FileEntry[] = [], removedIds: string[] = []): void {
    if (this.role !== 'host') return;
    const pool = usePoolStore.getState();
    this.transport.broadcastCtrl({
      type: 'POOL_UPDATE',
      payload: { version: pool.manifestVersion, added, removedIds },
    });
  }

  private protocolDeps(): ProtocolDeps {
    const isHost = () => this.role === 'host';
    const store = () => useSessionStore.getState();

    return {
      isHost,
      hostId: () => (isHost() ? store().selfId : this.hostId()),
      selfId: () => store().selfId,

      onHello: (payload: unknown, from: PeerId) => {
        const p = payload as { peerId?: string; name?: string };
        store().upsertPeer({
          id: from,
          name: p?.name || 'Guest',
          isHost: false,
          joinedAt: Date.now(),
          lastSeen: Date.now(),
        });
        // Reply + the delayed backup push in handlePeerJoin cover message loss.
        this.transport.sendCtrl(this.manifestMsg(), from);
      },

      onManifest: (payload: unknown, from: PeerId) => {
        if (this.handshakeDone) return;
        this.handshakeDone = true;
        if (this.helloTimer) {
          clearInterval(this.helloTimer);
          this.helloTimer = null;
        }
        const p = payload as {
          version: number;
          entries: FileEntry[];
          hostId: PeerId;
        };
        const pool = usePoolStore.getState();
        pool.applyManifest(p.version, p.entries);
        store().upsertPeer({
          id: from,
          name: 'Host',
          isHost: true,
          joinedAt: Date.now(),
          lastSeen: Date.now(),
        });
        store().setStatus('connected');
        this.reconnect.active = false;
        if (this.reconnect.timer) clearTimeout(this.reconnect.timer);

        // Report which entries we already have on disk; fetch ready previews.
        void rescanDirectory().then(() => {
          const have: string[] = [];
          for (const entry of Object.values(usePoolStore.getState().files)) {
            if (hasFile(entry.name, entry.size)) have.push(entry.id);
            else if (entry.preview.ready && !entry.preview.url) this.requestPreview(entry.id);
          }
          if (have.length > 0) {
            this.transport.sendCtrl({ type: 'HAVE_REPORT', payload: { fileIds: have } }, from);
          }
          recomputeLocalStates();
        });
      },

      onHostPing: () => {
        this.lastHostSeen = Date.now();
      },

      onHostReloading: () => {
        this.startReconnect('The host is reloading…');
      },

      onPoolUpdate: (payload: unknown) => {
        const p = payload as { version: number; added: FileEntry[]; removedIds: string[] };
        if (typeof p?.version !== 'number') return;
        usePoolStore.getState().applyUpdate(p.version, p.added ?? [], p.removedIds ?? []);
        recomputeLocalStates();
      },

      onFileAdded: (payload: unknown, from: PeerId) => {
        const p = payload as { entry?: FileEntry };
        const entry = p?.entry;
        if (!entry?.id || !isHost()) return;
        const pool = usePoolStore.getState();
        if (pool.files[entry.id]) {
          // Duplicate — re-echo current state so the sender converges.
          this.broadcastPoolUpdate([], []);
          return;
        }
        // NEVER trust localState from the wire — the sender's optimistic
        // 'local' must not hide the host's Download button for a file the
        // host doesn't have. Compute presence locally.
        pool.addLocal({
          ...entry,
          holders: entry.holders ?? [from],
          localState: computeLocalState(entry),
        });
        this.broadcastPoolUpdate([entry], []);
      },

      onFileRemoved: (payload: unknown, from: PeerId) => {
        const p = payload as { fileId?: string };
        if (!p?.fileId || !isHost()) return;
        const entry = usePoolStore.getState().files[p.fileId];
        // Only the sender or the host may remove an entry.
        if (!entry || (entry.senderId !== from && entry.senderId !== store().selfId)) return;
        usePoolStore.getState().removeLocal(p.fileId);
        this.broadcastPoolUpdate([], [p.fileId]);
      },

      onHaveReport: (payload: unknown, from: PeerId) => {
        const p = payload as { fileIds?: string[] };
        if (!p?.fileIds || !isHost()) return;
        const pool = usePoolStore.getState();
        for (const fileId of p.fileIds) {
          const entry = pool.files[fileId];
          if (entry && !entry.holders.includes(from)) {
            pool.setHolders(fileId, [...entry.holders, from]);
          }
        }
      },

      onPreviewReq: (payload: unknown, from: PeerId) => {
        const p = payload as { fileId?: string };
        const bytes = p?.fileId ? previewBytes.get(p.fileId) : undefined;
        if (bytes) {
          this.transport.sendPreview(encodeFrame(p.fileId!, 0, bytes), from);
        }
      },

      onDownloadReq: (payload: unknown, from: PeerId) => {
        const p = payload as { fileId?: string };
        if (!p?.fileId) return;
        const entry = usePoolStore.getState().files[p.fileId];
        if (!entry) return;
        void this.resolveLocalFile(p.fileId, entry.name).then((file) => {
          if (!file) {
            this.transport.sendCtrl(
              { type: 'TRANSFER_REJECT', payload: { fileId: p.fileId, reason: 'file not available' } },
              from
            );
            return;
          }
          this.engine.sendFile(p.fileId!, from, file, entry.name);
        });
      },

      onOffer: (p, from) => this.engine.handleOffer(p, from),
      onAccept: (p, from) => this.engine.handleAccept(p, from),
      onReject: (p, from) => this.engine.handleReject(p, from),
      onAck: (p, from) => this.engine.handleAck(p, from),
      onNak: (p, from) => this.engine.handleNak(p, from),
      onPause: (p, from) => this.engine.handlePause(p, from),
      onResume: (p, from) => this.engine.handleResume(p, from),
      onCancel: (p, from) => this.engine.handleCancel(p, from),
      onComplete: (p, from) => {
        this.engine.handleComplete(p, from);
        // Host now holds full bytes → tell everyone (Download unlocks).
        if (isHost()) this.broadcastPoolUpdate();
      },
    };
  }

  private hostId(): PeerId | null {
    const room = useSessionStore.getState();
    if (this.role === 'host') return room.selfId;
    for (const p of Object.values(room.peers)) {
      if (p.isHost) return p.id;
    }
    // Manifest not arrived yet — fall back to the only other peer in the room.
    return this.firstPeerId();
  }

  private handlePreviewData(data: unknown, from: PeerId): void {
    if (!(data instanceof ArrayBuffer)) return;
    const frame = decodeFrame(data);
    if (!frame || !frame.crcOk) return;
    previewBytes.set(frame.fileId, frame.payload);
    const url = URL.createObjectURL(
      new Blob([toArrayBuffer(frame.payload)], { type: 'image/jpeg' })
    );
    usePoolStore.getState().setPreview(frame.fileId, url, frame.payload.length);
    void from;
  }
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function guessMime(name: string): string {
  const ext = extOf(name);
  const table: Record<string, string> = {
    psd: 'image/vnd.adobe.photoshop',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    zip: 'application/zip',
    pdf: 'application/pdf',
  };
  return table[ext] ?? 'application/octet-stream';
}

export const session = new SessionController();

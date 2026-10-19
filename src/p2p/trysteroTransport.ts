// Trystero (BitTorrent strategy) transport singleton.
//
// Hardening patterns are ported from a proven implementation
// — each one marks a bug that actually happened there:
//   • import from '@trystero-p2p/torrent' (default entry = Nostr strategy;
//     'trystero/torrent' subpath ships empty type stubs)
//   • waitForFirstPeer polls getPeers() — onPeerJoin alone misses peers that
//     joined before the listener registered
//   • zombie room: joinRoom(sameId) right after leave() returns the STILL-LEAVING
//     instance → poll until a fresh instance appears
//   • module-scoped peer set survives StrictMode/HMR remounts (a per-instance
//     list goes stale while the room keeps delivering into the old closure)
//   • inbound messages are the strongest liveness proof — reconcile on every one

import { joinRoom } from '@trystero-p2p/torrent';
import { APP_ID, LEAVE_RACE_TIMEOUT_MS, TORRENT_TRACKERS } from '../constants';
import { createLogger } from '../utils/logger';
import type { CtrlMessage, PeerId } from '../types';
import type { Transport } from './transport';

const log = createLogger('transport');

type TrysteroRoom = {
  makeAction: (
    namespace: string
  ) => [
    (data: unknown, peerId?: PeerId) => void,
    (cb: (data: unknown, peerId: PeerId) => void) => () => void,
  ];
  onPeerJoin: (cb: (peerId: PeerId) => void) => () => void;
  onPeerLeave: (cb: (peerId: PeerId) => void) => () => void;
  leave: () => Promise<void> | void;
  getPeers: () => Record<string, unknown>;
};

type CtrlListener = (msg: CtrlMessage, fromPeerId: PeerId) => void;
type BinListener = (data: unknown, fromPeerId: PeerId) => void;
type PeerListener = (peerId: PeerId) => void;

/**
 * Module-scoped peer set (see header note). ADD-ONLY reconciliation:
 * a transiently empty getPeers() must not wipe known-good entries —
 * removal happens explicitly in onPeerLeave.
 */
const livePeers = new Set<PeerId>();

class TrysteroTransport implements Transport {
  private room: TrysteroRoom | null = null;
  private lastLeftRoom: TrysteroRoom | null = null;
  private sendCtrlAction: ((data: unknown, peerId?: PeerId) => void) | null = null;
  private sendBinAction: ((data: unknown, peerId?: PeerId) => void) | null = null;
  private sendPrvAction: ((data: unknown, peerId?: PeerId) => void) | null = null;

  private ctrlListeners = new Set<CtrlListener>();
  private binListeners = new Set<BinListener>();
  private prvListeners = new Set<BinListener>();
  private joinListeners = new Set<PeerListener>();
  private leaveListeners = new Set<PeerListener>();

  getRoomId(): string | null {
    return this.roomId;
  }
  private roomId: string | null = null;

  async hostRoom(roomId: string): Promise<void> {
    await this.join(roomId);
  }

  async joinAsGuest(roomId: string): Promise<void> {
    await this.join(roomId);
  }

  private async join(roomId: string): Promise<void> {
    if (this.room) await this.leave();
    const config = { appId: APP_ID, relayUrls: TORRENT_TRACKERS };
    let joinError: unknown = null;

    // Zombie-room poll: rejoining the same id can return the still-leaving
    // instance; poll until a FRESH room object appears (or give up on error).
    let room: TrysteroRoom | null = null;
    const deadline = Date.now() + 8_000;
    while (!room && !joinError && Date.now() < deadline) {
      room = await new Promise<TrysteroRoom | null>((resolve) => {
        let done = false;
        const finish = (r: TrysteroRoom | null) => {
          if (!done) {
            done = true;
            resolve(r);
          }
        };
        const r = joinRoom(config, roomId, {
          onJoinError: (details: unknown) => {
            log.error('Room join error:', details);
            joinError = details ?? new Error('join error');
            finish(null);
          },
        }) as unknown as TrysteroRoom;
        if (r !== this.lastLeftRoom) {
          finish(r);
        } else {
          // Still the leaving zombie — its async leave hasn't released the slot.
          setTimeout(() => finish(null), 200);
        }
      });
      if (!room && !joinError) await sleep(100);
    }

    if (!room) throw joinError ?? new Error('Could not obtain a fresh room');

    this.room = room;
    this.roomId = roomId;

    const [sendCtl, onDataCtl] = room.makeAction('ctl');
    const [sendBin, onDataBin] = room.makeAction('bin');
    const [sendPrv, onDataPrv] = room.makeAction('prv');
    this.sendCtrlAction = sendCtl;
    this.sendBinAction = sendBin;
    this.sendPrvAction = sendPrv;

    onDataCtl((data, peerId) => {
      // Inbound message = strongest liveness proof; reconcile the peer set.
      livePeers.add(peerId);
      const msg = data as CtrlMessage;
      if (!msg || typeof msg.type !== 'string') return;
      for (const cb of this.ctrlListeners) cb(msg, peerId);
    });

    onDataBin((data, peerId) => {
      livePeers.add(peerId);
      for (const cb of this.binListeners) cb(data, peerId);
    });

    onDataPrv((data, peerId) => {
      livePeers.add(peerId);
      for (const cb of this.prvListeners) cb(data, peerId);
    });

    room.onPeerJoin((peerId) => {
      log.info('Peer joined:', peerId);
      livePeers.add(peerId);
      for (const cb of this.joinListeners) cb(peerId);
    });

    room.onPeerLeave((peerId) => {
      log.info('Peer left:', peerId);
      livePeers.delete(peerId);
      for (const cb of this.leaveListeners) cb(peerId);
    });
  }

  async waitForFirstPeer(timeoutMs: number): Promise<boolean> {
    const room = this.room;
    if (!room) return false;
    return new Promise((resolve) => {
      let done = false;
      const finish = (found: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        clearInterval(poll);
        resolve(found);
      };
      const timeout = setTimeout(() => finish(false), timeoutMs);
      const poll = setInterval(() => {
        try {
          if (Object.keys(room.getPeers() || {}).length > 0) finish(true);
        } catch {
          // ignore — room may be closing
        }
        if (livePeers.size > 0) finish(true);
      }, 300);
      const off = room.onPeerJoin(() => {
        off();
        finish(true);
      });
    });
  }

  sendCtrl(msg: CtrlMessage, targetPeer?: PeerId): void {
    if (!this.sendCtrlAction) return;
    if (targetPeer && !livePeers.has(targetPeer)) {
      log.warn(
        `sendCtrl ${msg.type}: target peer ${targetPeer} is NOT in the room (live: ${[...livePeers].join(', ') || 'none'}) — message will be dropped`
      );
    }
    try {
      this.sendCtrlAction(msg, targetPeer);
    } catch (e) {
      log.warn('sendCtrl failed:', e);
    }
  }

  broadcastCtrl(msg: CtrlMessage): void {
    if (!this.sendCtrlAction) return;
    for (const peerId of livePeers) {
      try {
        this.sendCtrlAction(msg, peerId);
      } catch (e) {
        log.warn(`broadcastCtrl to ${peerId} failed:`, e);
      }
    }
  }

  sendBin(frame: ArrayBuffer, targetPeer: PeerId): void {
    if (!this.sendBinAction) return;
    try {
      this.sendBinAction(frame, targetPeer);
    } catch (e) {
      log.warn('sendBin failed:', e);
    }
  }

  sendPreview(frame: ArrayBuffer, targetPeer: PeerId): void {
    if (!this.sendPrvAction) return;
    try {
      this.sendPrvAction(frame, targetPeer);
    } catch (e) {
      log.warn('sendPreview failed:', e);
    }
  }

  onCtrl(cb: CtrlListener): () => void {
    this.ctrlListeners.add(cb);
    return () => this.ctrlListeners.delete(cb);
  }

  onBin(cb: BinListener): () => void {
    this.binListeners.add(cb);
    return () => this.binListeners.delete(cb);
  }

  onPreview(cb: BinListener): () => void {
    this.prvListeners.add(cb);
    return () => this.prvListeners.delete(cb);
  }

  onPeerJoin(cb: PeerListener): () => void {
    this.joinListeners.add(cb);
    return () => this.joinListeners.delete(cb);
  }

  onPeerLeave(cb: PeerListener): () => void {
    this.leaveListeners.add(cb);
    return () => this.leaveListeners.delete(cb);
  }

  getPeerIds(): PeerId[] {
    return [...livePeers];
  }

  async leave(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.lastLeftRoom = room;
    this.room = null;
    this.roomId = null;
    this.sendCtrlAction = null;
    this.sendBinAction = null;
    this.sendPrvAction = null;
    livePeers.clear();
    try {
      // leave() is ASYNC (signal + ~100ms + peer destroy). Race with a timeout
      // so a hung leave can't stall callers — the zombie poll handles the rest.
      await Promise.race([room.leave(), sleep(LEAVE_RACE_TIMEOUT_MS)]);
    } catch (e) {
      log.warn('leave() threw:', e);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let instance: TrysteroTransport | null = null;

export function getTransport(): TrysteroTransport {
  if (!instance) instance = new TrysteroTransport();
  return instance;
}

/** Test seam: reset the singleton between tests. */
export function resetTransportForTests(): void {
  instance = null;
  livePeers.clear();
}

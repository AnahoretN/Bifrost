import { create } from 'zustand';
import type { PeerId, PeerInfo } from '../types';

export type SessionStatus =
  | 'lobby'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

interface SessionState {
  status: SessionStatus;
  role: 'host' | 'guest' | null;
  selfId: PeerId;
  selfName: string;
  roomId: string | null;
  inviteLink: string | null;
  peers: Record<PeerId, PeerInfo>;
  /** Transient connect/handshake status text for the loading UI. */
  statusMessage: string;

  setSelf: (id: PeerId, name: string) => void;
  setRoom: (roomId: string, inviteLink: string) => void;
  setStatus: (status: SessionStatus, message?: string) => void;
  upsertPeer: (peer: PeerInfo) => void;
  removePeer: (peerId: PeerId) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'lobby',
  role: null,
  selfId: '',
  selfName: '',
  roomId: null,
  inviteLink: null,
  peers: {},
  statusMessage: '',

  setSelf: (id, name) => set({ selfId: id, selfName: name }),
  setRoom: (roomId, inviteLink) => set({ roomId, inviteLink }),
  setStatus: (status, message) =>
    set((s) => ({ status, statusMessage: message ?? s.statusMessage })),
  upsertPeer: (peer) => set((s) => ({ peers: { ...s.peers, [peer.id]: peer } })),
  removePeer: (peerId) =>
    set((s) => {
      const peers = { ...s.peers };
      delete peers[peerId];
      return { peers };
    }),
  reset: () =>
    set({
      status: 'lobby',
      role: null,
      roomId: null,
      inviteLink: null,
      peers: {},
      statusMessage: '',
    }),
}));

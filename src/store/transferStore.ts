import { create } from 'zustand';
import { transferKey } from '../utils/id';
import type { Transfer, TransferDirection, TransferState, TransferKey } from '../types';

interface TransferStateStore {
  transfers: Record<TransferKey, Transfer>;
  /** FIFO queues: at most one active transfer per remote peer, per side. */
  queues: Record<string, TransferKey[]>;

  upsert: (
    fileId: string,
    remotePeerId: string,
    direction: TransferDirection,
    patch: Partial<Transfer> & { fileName?: string; bytesTotal?: number }
  ) => void;
  setState: (key: TransferKey, state: TransferState, error?: string) => void;
  progress: (key: TransferKey, bytesDone: number, rateBps: number, etaSec: number) => void;
  enqueue: (peerId: string, key: TransferKey) => void;
  dequeue: (peerId: string) => TransferKey | undefined;
  remove: (key: TransferKey) => void;
  reset: () => void;
}

export const useTransferStore = create<TransferStateStore>((set, get) => ({
  transfers: {},
  queues: {},

  upsert: (fileId, remotePeerId, direction, patch) => {
    const key = transferKey(fileId, remotePeerId, direction);
    set((s) => {
      const existing: Transfer = s.transfers[key] ?? {
        key,
        fileId,
        fileName: '',
        direction,
        remotePeerId,
        state: 'queued',
        bytesDone: 0,
        bytesTotal: 0,
        rateBps: 0,
        etaSec: 0,
      };
      return { transfers: { ...s.transfers, [key]: { ...existing, ...patch, key } } };
    });
  },

  setState: (key, state, error) =>
    set((s) => {
      const t = s.transfers[key];
      if (!t) return s;
      return {
        transfers: {
          ...s.transfers,
          [key]: { ...t, state, error: error ?? (state === 'failed' ? t.error : undefined) },
        },
      };
    }),

  progress: (key, bytesDone, rateBps, etaSec) =>
    set((s) => {
      const t = s.transfers[key];
      if (!t) return s;
      return { transfers: { ...s.transfers, [key]: { ...t, bytesDone, rateBps, etaSec } } };
    }),

  enqueue: (peerId, key) =>
    set((s) => {
      const q = s.queues[peerId] ?? [];
      if (q.includes(key)) return s;
      return { queues: { ...s.queues, [peerId]: [...q, key] } };
    }),

  dequeue: (peerId) => {
    const q = get().queues[peerId] ?? [];
    if (q.length === 0) return undefined;
    const [head, ...rest] = q;
    set((s) => ({ queues: { ...s.queues, [peerId]: rest } }));
    return head;
  },

  remove: (key) =>
    set((s) => {
      const transfers = { ...s.transfers };
      delete transfers[key];
      return { transfers };
    }),

  reset: () => set({ transfers: {}, queues: {} }),
}));

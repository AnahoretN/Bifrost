import { create } from 'zustand';
import type { FileEntry, LocalFileState } from '../types';

/**
 * File pool. The host is the authority: FILE_ADDED/FILE_REMOVED requests bump the
 * version and are echoed to everyone as POOL_UPDATE. Guests apply POOL_UPDATE
 * verbatim and only compute localState locally.
 */

interface PoolState {
  files: Record<string, FileEntry>;
  order: string[];
  manifestVersion: number;

  /** Host-side: apply an add request and bump version. Returns the new version. */
  addLocal: (entry: FileEntry) => number;
  /** Host-side: apply a remove request and bump version. Returns the new version. */
  removeLocal: (fileId: string) => number;
  /** Guest-side (and host echo): replace the whole set from a manifest. */
  applyManifest: (version: number, entries: FileEntry[]) => void;
  /** Guest-side: apply an incremental update. */
  applyUpdate: (version: number, added: FileEntry[], removedIds: string[]) => void;
  setHolders: (fileId: string, holders: string[]) => void;
  setPreview: (fileId: string, url: string, byteLength: number) => void;
  /** Recompute localState for entries against the folder index (name|size set). */
  markLocalStates: (fn: (entry: FileEntry) => LocalFileState) => void;
  reset: () => void;
}

export const usePoolStore = create<PoolState>((set, get) => ({
  files: {},
  order: [],
  manifestVersion: 0,

  addLocal: (entry) => {
    let version = 0;
    set((s) => {
      version = s.manifestVersion + 1;
      if (s.files[entry.id]) return s; // idempotent re-add
      return {
        files: { ...s.files, [entry.id]: entry },
        order: [...s.order, entry.id],
        manifestVersion: version,
      };
    });
    return version;
  },

  removeLocal: (fileId) => {
    let version = 0;
    set((s) => {
      if (!s.files[fileId]) return s;
      version = s.manifestVersion + 1;
      const files = { ...s.files };
      delete files[fileId];
      return {
        files,
        order: s.order.filter((id) => id !== fileId),
        manifestVersion: version,
      };
    });
    return version;
  },

  applyManifest: (version, entries) => {
    const files: Record<string, FileEntry> = {};
    const order: string[] = [];
    for (const e of entries) {
      // Keep any preview bytes already fetched for known ids.
      const existing = get().files[e.id];
      files[e.id] = existing?.preview.url ? { ...e, preview: existing.preview } : e;
      order.push(e.id);
    }
    set({ files, order, manifestVersion: version });
  },

  applyUpdate: (version, added, removedIds) => {
    set((s) => {
      const files = { ...s.files };
      let order = s.order.filter((id) => !removedIds.includes(id));
      for (const e of added) {
        const existing = files[e.id];
        files[e.id] = existing?.preview.url ? { ...e, preview: existing.preview } : e;
        if (!existing) order = [...order, e.id];
      }
      for (const id of removedIds) delete files[id];
      return { files, order, manifestVersion: version };
    });
  },

  setHolders: (fileId, holders) =>
    set((s) => {
      const f = s.files[fileId];
      if (!f) return s;
      return { files: { ...s.files, [fileId]: { ...f, holders } } };
    }),

  setPreview: (fileId, url, byteLength) =>
    set((s) => {
      const f = s.files[fileId];
      if (!f) return s;
      return {
        files: {
          ...s.files,
          [fileId]: { ...f, preview: { ready: true, url, byteLength } },
        },
      };
    }),

  markLocalStates: (fn) =>
    set((s) => {
      const files: Record<string, FileEntry> = {};
      for (const [id, f] of Object.entries(s.files)) {
        files[id] = { ...f, localState: fn(f) };
      }
      return { files };
    }),

  reset: () => set({ files: {}, order: [], manifestVersion: 0 }),
}));

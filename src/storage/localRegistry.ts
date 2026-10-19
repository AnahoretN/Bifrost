// Local-bytes registry + presence computation.
//
// "On device" means either (a) the file was added locally this session (bytes
// are on disk somewhere — the File object is in this registry), or (b) a
// name+size match exists in the save-folder index. Each peer computes this
// INDEPENDENTLY — an entry's localState must never be trusted across the wire
// (a guest's optimistic 'local' used to leak to the host, hiding Download).

import { hasFile } from './directoryIndex';
import { usePoolStore } from '../store/poolStore';
import type { FileEntry, LocalFileState } from '../types';

/** Files added locally this session (bytes exist on this device). */
const localFiles = new Map<string, File>();

export function registerLocalFile(fileId: string, file: File): void {
  localFiles.set(fileId, file);
}

export function getLocalFile(fileId: string): File | null {
  return localFiles.get(fileId) ?? null;
}

export function computeLocalState(
  entry: Pick<FileEntry, 'id' | 'name' | 'size'>
): LocalFileState {
  if (localFiles.has(entry.id) || hasFile(entry.name, entry.size)) return 'local';
  return 'remote';
}

/** Recompute localState for every pool entry (after manifest/update/rescan). */
export function recomputeLocalStates(): void {
  usePoolStore.getState().markLocalStates(computeLocalState);
}

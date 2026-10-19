// Save-folder access. Primary path: File System Access API (stream chunks
// straight to disk — the only browser path that handles 10GB+). Fallback: OPFS
// (app-private, iOS Safari) with an explicit Export button per file.

import { idbDelete, idbGet, idbSet, STORE_HANDLES } from './idb';
import { createLogger } from '../utils/logger';

const log = createLogger('storage');
const HANDLE_KEY = 'save-folder';

export type StorageMode = 'fs-access' | 'opfs' | 'none';

export function supportsFsAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function storageMode(): StorageMode {
  if (supportsFsAccess()) return 'fs-access';
  if (
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function'
  ) {
    return 'opfs';
  }
  return 'none';
}

let dirHandle: FileSystemDirectoryHandle | null = null;
/** Cached permission verdict — sync consumers (transfer-queue gating) read this;
 * the async checks below keep it fresh. */
let granted = false;

/** Sync gate used by the transfer engine's canReceive(). */
export function canWrite(): boolean {
  const mode = storageMode();
  if (mode === 'opfs') return true;
  if (mode !== 'fs-access') return false;
  return dirHandle != null && granted;
}

/** Persisted handle from a previous session, if any. */
export async function loadSavedFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (dirHandle) return dirHandle;
  try {
    const saved = await idbGet<FileSystemDirectoryHandle>(STORE_HANDLES, HANDLE_KEY);
    if (saved) dirHandle = saved;
  } catch (e) {
    log.warn('loadSavedFolder failed:', e);
  }
  return dirHandle;
}

/**
 * Permission state for the persisted handle. 'prompt' means a user gesture is
 * required — the UI must gate behind a button (browsers forbid silent prompts).
 */
export async function queryFolderPermission(): Promise<PermissionState | 'unsupported'> {
  const handle = await loadSavedFolder();
  if (!handle) return 'unsupported';
  // TS lib.dom may not know queryPermission on handles yet.
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  };
  if (!h.queryPermission) {
    granted = true;
    return 'granted';
  }
  const state = await h.queryPermission({ mode: 'readwrite' });
  granted = state === 'granted';
  return state;
}

/** User-gesture entry point: pick a folder and persist the handle. */
export async function pickSaveFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsFsAccess()) return null;
  try {
    // Type is present at runtime; lib.dom typing varies across versions.
    const picker = (window as unknown as {
      showDirectoryPicker: (o?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    const handle = await picker({ mode: 'readwrite' });
    dirHandle = handle;
    granted = true;
    await idbSet(STORE_HANDLES, HANDLE_KEY, handle);
    try {
      await navigator.storage?.persist?.();
    } catch {
      // best-effort — eviction protection isn't critical to function
    }
    return handle;
  } catch (e) {
    log.warn('pickSaveFolder cancelled/failed:', e);
    return null;
  }
}

/** Re-grant a persisted handle (must be called from a user gesture). */
export async function regrantFolder(): Promise<boolean> {
  const handle = await loadSavedFolder();
  if (!handle) return false;
  const h = handle as FileSystemDirectoryHandle & {
    requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  };
  if (!h.requestPermission) return true;
  try {
    granted = (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
    return granted;
  } catch {
    return false;
  }
}

/** Forget the folder (user picked a different one). */
export async function forgetSaveFolder(): Promise<void> {
  dirHandle = null;
  granted = false;
  await idbDelete(STORE_HANDLES, HANDLE_KEY);
}

/** Resolve the OPFS root when FS Access is unavailable. */
export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

export async function getRootDir(): Promise<FileSystemDirectoryHandle | null> {
  if (storageMode() === 'fs-access') {
    const handle = await loadSavedFolder();
    return handle && (await queryFolderPermission()) === 'granted' ? handle : null;
  }
  return getOpfsRoot();
}

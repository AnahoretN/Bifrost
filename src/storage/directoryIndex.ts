// Directory presence index: scans the save folder into a name|size → handle map.
// Answers "do I already have this file?" and "where do I write this download?".
// Re-scanned at join, after each completion, and on folder re-selection.

import { createLogger } from '../utils/logger';
import { getRootDir } from './fileSystemAccess';

const log = createLogger('dirIndex');

export interface DirEntry {
  name: string;
  size: number;
  handle: FileSystemFileHandle;
}

let index = new Map<string, DirEntry>();
let scanSeq = 0;

function key(name: string, size: number): string {
  return `${name}|${size}`;
}

export async function rescanDirectory(): Promise<Map<string, DirEntry>> {
  const seq = ++scanSeq;
  const next = new Map<string, DirEntry>();
  const root = await getRootDir();
  if (root) {
    try {
      // lib.dom doesn't declare entries() yet on older TS libs.
      const dir = root as FileSystemDirectoryHandle & {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      };
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue;
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          next.set(key(name, file.size), {
            name,
            size: file.size,
            handle: handle as FileSystemFileHandle,
          });
        } catch {
          // unreadable entry — skip it
        }
        if (seq !== scanSeq) return index; // superseded by a newer scan
      }
    } catch (e) {
      log.warn('directory scan failed:', e);
    }
  }
  index = next;
  return index;
}

export function hasFile(name: string, size: number): boolean {
  return index.has(key(name, size));
}

/** Full-bytes handle for sending: match by name+size, fall back to name only. */
export function findHandle(name: string, size: number): FileSystemFileHandle | null {
  const exact = index.get(key(name, size));
  if (exact) return exact.handle;
  for (const entry of index.values()) {
    if (entry.name === name) return entry.handle;
  }
  return null;
}

/** Reserve a writable target, appending " (2)"-style suffixes on collision. */
export async function openWriteTarget(
  name: string
): Promise<{ writable: FileSystemWritableFileStream; finalName: string } | null> {
  const root = await getRootDir();
  if (!root) return null;
  const finalName = await uniqueName(root, name);
  const handle = await root.getFileHandle(finalName, { create: true });
  const writable = await handle.createWritable(); // truncates
  return { writable, finalName };
}

async function uniqueName(
  root: FileSystemDirectoryHandle,
  name: string
): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  let n = 2;
  while (await exists(root, candidate)) {
    candidate = `${stem} (${n})${ext}`;
    n++;
  }
  return candidate;
}

async function exists(root: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await root.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export async function removeFile(name: string): Promise<void> {
  const root = await getRootDir();
  if (!root) return;
  try {
    await root.removeEntry(name);
  } catch {
    // already gone
  }
}

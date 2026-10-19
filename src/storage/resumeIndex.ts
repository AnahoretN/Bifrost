// Resume index: fileId → chunk index the receiver has durably written.
// Persisted after every CHUNK_ACK so a page reload mid-transfer can resume
// instead of restarting a 10GB download. Record also carries the partial
// file's name so the resume path can find/reopen it.

import { idbDelete, idbGet, idbSet, STORE_RESUME } from './idb';

export interface ResumeRecord {
  fileId: string;
  fileName: string;
  /** all chunks in [0, nextIndex) are durably on disk. */
  nextIndex: number;
  chunkSize: number;
}

export async function getResume(fileId: string): Promise<ResumeRecord | undefined> {
  return idbGet<ResumeRecord>(STORE_RESUME, fileId);
}

export async function setResume(rec: ResumeRecord): Promise<void> {
  await idbSet(STORE_RESUME, rec.fileId, rec);
}

export async function clearResume(fileId: string): Promise<void> {
  await idbDelete(STORE_RESUME, fileId);
}

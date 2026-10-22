import { Info, Pause, Play, Send, Trash2, XCircle, Download, Share2 } from 'lucide-react';
import { session } from '../p2p/sessionController';
import { useSessionStore } from '../store/sessionStore';
import { useTransferStore } from '../store/transferStore';
import { transferKey } from '../utils/id';
import { formatDate, formatBytes } from '../utils/format';
import { storageMode } from '../storage/fileSystemAccess';
import { exportLocalFile } from '../storage/exportLocal';
import type { FileEntry, TransferState } from '../types';
import PreviewThumb from './PreviewThumb';

const ACTIVE: TransferState[] = ['queued', 'requesting', 'transferring', 'paused'];

interface Props {
  entry: FileEntry;
  onInfo: (entry: FileEntry) => void;
}

export default function FileRow({ entry, onInfo }: Props) {
  const selfId = useSessionStore((s) => s.selfId);
  const role = useSessionStore((s) => s.role);
  const peers = useSessionStore((s) => s.peers);
  const transfers = useTransferStore((s) => s.transfers);

  const hostId =
    role === 'host' ? selfId : Object.values(peers).find((p) => p.isHost)?.id ?? null;
  // Ownership survives reloads via the stable device id.
  const iAmSender =
    entry.senderId === selfId ||
    (!!entry.senderDeviceId && entry.senderDeviceId === session.myDeviceId());
  const hostHolds = hostId != null && entry.holders.includes(hostId);
  const isLocal = entry.localState === 'local';
  // Anyone else holding full bytes can serve the download (host preferred,
  // but a guest that added the file works too).
  const otherHolders = entry.holders.filter((h) => h !== selfId);

  // The transfer for this file that involves me and the host (either direction).
  const candidate =
    hostId != null
      ? transfers[transferKey(entry.id, hostId, 'receive')] ??
        transfers[transferKey(entry.id, hostId, 'send')]
      : undefined;
  const active = candidate && ACTIVE.includes(candidate.state) ? candidate : null;

  const canSend = role === 'guest' && iAmSender && !hostHolds && isLocal && !active;
  const canDownload = !isLocal && !active && otherHolders.length > 0;
  // Files in app-private storage (OPFS — phones, Firefox) need an explicit
  // way out: OS share sheet (Android) or a classic download.
  const canExport = storageMode() === 'opfs' && isLocal;

  return (
    <div className="card flex items-center gap-3 p-3">
      <PreviewThumb entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-100">{entry.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          <span>{formatBytes(entry.size)}</span>
          <span>·</span>
          <span className="uppercase">{entry.ext || 'file'}</span>
          <span>·</span>
          <span>by {entry.senderId === selfId ? 'you' : entry.senderName}</span>
          <span>·</span>
          <span>{formatDate(entry.addedAt)}</span>
          {isLocal && <span className="badge bg-emerald-900/60 text-emerald-300">on device</span>}
          {active && (
            <span className="badge bg-bifrost-900/60 text-bifrost-300">{active.state}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {active ? (
          <>
            {active.state === 'paused' ? (
              <button
                className="btn-secondary"
                title="Resume"
                onClick={() => session.engine.resumeTransfer(active.key)}
              >
                <Play className="h-4 w-4" />
              </button>
            ) : (
              <button
                className="btn-secondary"
                title="Pause"
                onClick={() => session.engine.pauseTransfer(active.key)}
              >
                <Pause className="h-4 w-4" />
              </button>
            )}
            <button
              className="btn-danger"
              title="Cancel"
              onClick={() => session.engine.cancelTransfer(active.key)}
            >
              <XCircle className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            {canSend && (
              <button
                className="btn-primary"
                onClick={() => {
                  const file = session.localFileFor(entry.id);
                  if (file && hostId) session.engine.sendFile(entry.id, hostId, file, entry.name);
                }}
              >
                <Send className="h-4 w-4" /> Send
              </button>
            )}
            {!isLocal && (
              <button
                className="btn-secondary"
                disabled={!canDownload}
                title={
                  otherHolders.length === 0
                    ? 'Nobody holds this file yet'
                    : `Download from ${otherHolders.includes(hostId ?? '') ? 'the host' : entry.senderName}`
                }
                onClick={() => session.downloadFile(entry.id)}
              >
                <Download className="h-4 w-4" /> Download
              </button>
            )}
            {canExport && (
              <button
                className="btn-secondary"
                title="Save this file out of the app (share sheet or download)"
                onClick={() => void exportLocalFile(entry.name, entry.size)}
              >
                <Share2 className="h-4 w-4" /> Export
              </button>
            )}
          </>
        )}
        <button className="btn-secondary" title="Details" onClick={() => onInfo(entry)}>
          <Info className="h-4 w-4" />
        </button>
        {(role === 'host' || iAmSender) && !active && (
          <button
            className="btn-danger"
            title="Remove from pool"
            onClick={() => session.removeFile(entry.id)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

import { X } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { formatDate, formatBytes } from '../utils/format';
import type { FileEntry } from '../types';
import PreviewThumb from './PreviewThumb';

/** Detailed information about a pool file (right-side drawer). */
export default function FileDetailDrawer({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const selfId = useSessionStore((s) => s.selfId);
  const peers = useSessionStore((s) => s.peers);

  const nameOf = (peerId: string) =>
    peerId === selfId ? 'you' : peers[peerId]?.name ?? peerId.slice(0, 8);

  const rows: Array<[string, string]> = [
    ['Name', entry.name],
    ['Size', `${formatBytes(entry.size)} (${entry.size.toLocaleString()} bytes)`],
    ['Type', entry.mime],
    ['Extension', `.${entry.ext || '—'}`],
    ['Added by', entry.senderId === selfId ? 'you' : `${entry.senderName} (${entry.senderId.slice(0, 8)})`],
    ['Added at', formatDate(entry.addedAt)],
    [
      'Held by',
      entry.holders.length > 0 ? entry.holders.map(nameOf).join(', ') : '—',
    ],
    ['On this device', entry.localState === 'local' ? 'yes' : 'no'],
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/60" onClick={onClose}>
      <div
        className="card h-full w-full max-w-sm overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="break-all text-base font-semibold text-slate-100">File details</h3>
          <button className="btn-secondary px-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex justify-center">
          {entry.preview.url ? (
            <img
              src={entry.preview.url}
              alt=""
              className="max-h-72 w-full rounded-lg border border-slate-700 object-contain"
            />
          ) : (
            <PreviewThumb entry={entry} />
          )}
        </div>
        <dl className="mt-5 space-y-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt>
              <dd className="mt-0.5 break-all text-slate-200">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

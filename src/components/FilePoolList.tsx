import { useState } from 'react';
import { FolderPlus, Upload } from 'lucide-react';
import { session } from '../p2p/sessionController';
import { usePoolStore } from '../store/poolStore';
import { useSessionStore } from '../store/sessionStore';
import type { FileEntry } from '../types';
import FileRow from './FileRow';
import FileDetailDrawer from './FileDetailDrawer';

/**
 * Pool grouped into two primary sections:
 *  • "У хоста" — every file the host holds (host's own + everything sent to it);
 *  • "На устройстве" — files living only on this device (not yet sent);
 * plus a fallback section for remote files held by neither (only if non-empty).
 */
export default function FilePoolList() {
  const order = usePoolStore((s) => s.order);
  const files = usePoolStore((s) => s.files);
  const role = useSessionStore((s) => s.role);
  const selfId = useSessionStore((s) => s.selfId);
  const peers = useSessionStore((s) => s.peers);
  const [detail, setDetail] = useState<FileEntry | null>(null);

  const hostId =
    role === 'host' ? selfId : Object.values(peers).find((p) => p.isHost)?.id ?? null;

  const atHost: FileEntry[] = [];
  const onDevice: FileEntry[] = [];
  const elsewhere: FileEntry[] = [];
  for (const id of order) {
    const entry = files[id];
    if (!entry) continue;
    if (hostId != null && entry.holders.includes(hostId)) atHost.push(entry);
    else if (entry.localState === 'local') onDevice.push(entry);
    else elsewhere.push(entry);
  }

  const addFiles = (list: FileList | null) => {
    if (list && list.length > 0) void session.addFiles(Array.from(list));
  };

  return (
    <div className="flex-1">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          File pool ({order.length})
        </h2>
        <label className="btn-primary cursor-pointer">
          <FolderPlus className="h-4 w-4" /> Add files
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {order.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-2 p-10 text-center text-slate-500">
          <Upload className="h-8 w-8 text-slate-700" />
          <div className="text-sm">The pool is empty — add files to share them.</div>
          <div className="text-xs text-slate-600">
            Files you add can be sent to the host with Send / Send All.
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <Section title={`У хоста (${atHost.length})`} entries={atHost} onInfo={setDetail} />
          <Section
            title={`На устройстве (${onDevice.length})`}
            entries={onDevice}
            onInfo={setDetail}
            emptyHint="Нет файлов, ожидающих отправки"
          />
          {elsewhere.length > 0 && (
            <Section
              title={`У других участников (${elsewhere.length})`}
              entries={elsewhere}
              onInfo={setDetail}
            />
          )}
        </div>
      )}

      {detail && <FileDetailDrawer entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Section({
  title,
  entries,
  onInfo,
  emptyHint,
}: {
  title: string;
  entries: FileEntry[];
  onInfo: (entry: FileEntry) => void;
  emptyHint?: string;
}) {
  if (entries.length === 0) {
    return emptyHint ? (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </h3>
        <div className="rounded-lg border border-dashed border-slate-800 p-3 text-center text-xs text-slate-600">
          {emptyHint}
        </div>
      </div>
    ) : null;
  }
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <div className="space-y-2">
        {entries.map((entry) => (
          <FileRow key={entry.id} entry={entry} onInfo={onInfo} />
        ))}
      </div>
    </div>
  );
}

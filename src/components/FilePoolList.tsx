import { useState } from 'react';
import { FolderPlus, Upload } from 'lucide-react';
import { session } from '../p2p/sessionController';
import { usePoolStore } from '../store/poolStore';
import type { FileEntry } from '../types';
import FileRow from './FileRow';
import FileDetailDrawer from './FileDetailDrawer';

export default function FilePoolList() {
  const order = usePoolStore((s) => s.order);
  const files = usePoolStore((s) => s.files);
  const [detail, setDetail] = useState<FileEntry | null>(null);

  const addFiles = (list: FileList | null) => {
    if (list && list.length > 0) void session.addFiles(Array.from(list));
  };

  return (
    <div className="flex-1">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          File pool ({order.length})
        </h2>
        <div className="flex items-center gap-2">
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
        <div className="space-y-2">
          {order.map((id) => {
            const entry = files[id];
            if (!entry) return null;
            return <FileRow key={id} entry={entry} onInfo={setDetail} />;
          })}
        </div>
      )}

      {detail && <FileDetailDrawer entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

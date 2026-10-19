import { File, FileImage, FileVideo, Image as ImageIcon } from 'lucide-react';
import type { FileEntry } from '../types';

function iconFor(entry: FileEntry) {
  if (entry.mime.startsWith('video/')) return FileVideo;
  if (entry.mime.startsWith('image/') || entry.ext === 'psd') return FileImage;
  return File;
}

/**
 * Preview thumbnail: shows the sender-generated JPEG when it has arrived,
 * a type icon when the preview exists but hasn't loaded yet, and a dimmed
 * type icon when no preview was ever generated.
 */
export default function PreviewThumb({ entry }: { entry: FileEntry }) {
  if (entry.preview.url) {
    return (
      <img
        src={entry.preview.url}
        alt=""
        className="h-14 w-14 shrink-0 rounded-lg border border-slate-700 object-cover"
      />
    );
  }
  const Icon = iconFor(entry);
  const pending = entry.preview.ready && !entry.preview.url;
  return (
    <div
      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-slate-700 ${
        pending ? 'animate-pulse bg-slate-800/60' : 'bg-slate-800'
      }`}
    >
      {pending ? (
        <ImageIcon className="h-6 w-6 text-slate-600" />
      ) : (
        <Icon className="h-6 w-6 text-slate-500" />
      )}
    </div>
  );
}

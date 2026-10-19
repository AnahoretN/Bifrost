import { AlertTriangle } from 'lucide-react';
import type { StorageMode } from '../storage/fileSystemAccess';

/** Sets expectations where File System Access is missing (e.g. iOS Safari → OPFS). */
export default function UnsupportedBrowserBanner({ mode }: { mode: StorageMode }) {
  if (mode === 'fs-access') return null;
  if (mode === 'none') {
    return (
      <div className="flex items-center gap-2 bg-red-950/60 px-4 py-2 text-sm text-red-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        This browser doesn&apos;t support saving files to disk. Please use Chrome or Edge on
        desktop.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 bg-amber-950/50 px-4 py-2 text-sm text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      Full save-to-folder isn&apos;t available here — received files land in app-private
      storage and can be exported per file after download.
    </div>
  );
}

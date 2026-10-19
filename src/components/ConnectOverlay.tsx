import { Loader2 } from 'lucide-react';

/** Blocking overlay during initial join and reconnection attempts. */
export default function ConnectOverlay({ status }: { status: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="card flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-bifrost-400" />
        <div className="text-sm text-slate-300">{status || 'Connecting…'}</div>
      </div>
    </div>
  );
}

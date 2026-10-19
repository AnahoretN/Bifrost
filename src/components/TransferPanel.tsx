import { ArrowDown, ArrowUp, Pause, Play, XCircle } from 'lucide-react';
import { session } from '../p2p/sessionController';
import { useTransferStore } from '../store/transferStore';
import { formatBytes, formatEta, formatRate } from '../utils/format';
import type { Transfer } from '../types';

const VISIBLE = new Set(['requesting', 'transferring', 'paused']);

export default function TransferPanel() {
  const transfers = useTransferStore((s) => s.transfers);
  const list = Object.values(transfers)
    .filter((t) => VISIBLE.has(t.state) || (t.state === 'failed' && t.error))
    .sort((a, b) => a.key.localeCompare(b.key));

  if (list.length === 0) return null;

  return (
    <div className="card p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transfers</h3>
      <div className="mt-2 space-y-2">
        {list.map((t) => (
          <TransferItem key={t.key} t={t} />
        ))}
      </div>
    </div>
  );
}

function TransferItem({ t }: { t: Transfer }) {
  const pct = t.bytesTotal > 0 ? Math.min(100, (t.bytesDone / t.bytesTotal) * 100) : 0;
  return (
    <div className="rounded-lg bg-slate-800/50 p-2.5">
      <div className="flex items-center gap-2 text-xs">
        {t.direction === 'receive' ? (
          <ArrowDown className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <ArrowUp className="h-3.5 w-3.5 text-bifrost-400" />
        )}
        <span className="min-w-0 flex-1 truncate text-slate-200">{t.fileName}</span>
        {t.state === 'transferring' && (
          <span className="shrink-0 text-slate-500">
            {formatRate(t.rateBps)} · ETA {formatEta(t.etaSec)}
          </span>
        )}
        {t.state === 'failed' && (
          <span className="shrink-0 text-red-400">{t.error ?? 'failed'}</span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {t.state === 'paused' ? (
            <button
              className="btn-secondary px-1.5 py-1"
              title="Resume"
              onClick={() => session.engine.resumeTransfer(t.key)}
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          ) : (
            VISIBLE.has(t.state) && (
              <button
                className="btn-secondary px-1.5 py-1"
                title="Pause"
                onClick={() => session.engine.pauseTransfer(t.key)}
              >
                <Pause className="h-3.5 w-3.5" />
              </button>
            )
          )}
          {VISIBLE.has(t.state) && (
            <button
              className="btn-danger px-1.5 py-1"
              title="Cancel"
              onClick={() => session.engine.cancelTransfer(t.key)}
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-slate-900">
        <div
          className={`h-full rounded transition-[width] ${t.state === 'failed' ? 'bg-red-500' : 'bg-bifrost-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {formatBytes(t.bytesDone)} / {formatBytes(t.bytesTotal)} ({pct.toFixed(0)}%)
      </div>
    </div>
  );
}

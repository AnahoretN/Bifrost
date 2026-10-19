import { Crown, User } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';

export default function ParticipantsPanel() {
  const selfName = useSessionStore((s) => s.selfName);
  const role = useSessionStore((s) => s.role);
  const peers = useSessionStore((s) => s.peers);
  const peerList = Object.values(peers);

  return (
    <div className="card p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Participants ({peerList.length + 1})
      </h3>
      <ul className="mt-2 space-y-1.5 text-sm">
        <li className="flex items-center gap-2">
          {role === 'host' ? (
            <Crown className="h-4 w-4 text-amber-400" />
          ) : (
            <User className="h-4 w-4 text-slate-500" />
          )}
          <span className="text-slate-200">{selfName || 'Me'}</span>
          <span className="badge bg-slate-800 text-slate-400">you</span>
        </li>
        {peerList.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            {p.isHost ? (
              <Crown className="h-4 w-4 text-amber-400" />
            ) : (
              <User className="h-4 w-4 text-slate-500" />
            )}
            <span className="text-slate-200">{p.name}</span>
            {p.isHost && <span className="badge bg-amber-900/50 text-amber-300">host</span>}
          </li>
        ))}
        {peerList.length === 0 && (
          <li className="text-xs text-slate-600">Waiting for others to join via the link…</li>
        )}
      </ul>
    </div>
  );
}

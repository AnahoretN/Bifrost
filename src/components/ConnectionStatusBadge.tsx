import { useEffect } from 'react';
import { Users, Wifi, WifiOff } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';

export default function ConnectionStatusBadge() {
  const status = useSessionStore((s) => s.status);
  const peerCount = useSessionStore((s) => Object.keys(s.peers).length);

  const connected = status === 'connected';
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      {connected ? (
        <Wifi className="h-4 w-4 text-emerald-400" />
      ) : (
        <WifiOff className="h-4 w-4 text-red-400" />
      )}
      <span>{connected ? 'Connected' : status}</span>
      <span className="flex items-center gap-1">
        <Users className="h-4 w-4" /> {peerCount + 1}
      </span>
    </div>
  );
}

/** Keeps peer lastSeen fresh enough for the participants panel. */
export function usePeerHeartbeat() {
  const peers = useSessionStore((s) => s.peers);
  useEffect(() => {
    if (Object.keys(peers).length === 0) return;
    const t = setInterval(() => {
      const store = useSessionStore.getState();
      for (const id of Object.keys(store.peers)) {
        store.upsertPeer({ ...store.peers[id], lastSeen: Date.now() });
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [Object.keys(peers).length]);
}

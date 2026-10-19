import { ArrowDownToLine, LogOut, Send } from 'lucide-react';
import { session } from '../p2p/sessionController';
import { useSessionStore } from '../store/sessionStore';
import { usePoolStore } from '../store/poolStore';
import ConnectionStatusBadge, { usePeerHeartbeat } from './ConnectionStatusBadge';
import InviteLinkBar from './InviteLinkBar';
import ParticipantsPanel from './ParticipantsPanel';
import FilePoolList from './FilePoolList';
import TransferPanel from './TransferPanel';
import SaveFolderPrompt from './SaveFolderPrompt';

export default function RoomScreen() {
  const role = useSessionStore((s) => s.role);
  const status = useSessionStore((s) => s.status);
  const selfId = useSessionStore((s) => s.selfId);
  const peers = useSessionStore((s) => s.peers);
  const files = usePoolStore((s) => s.files);
  usePeerHeartbeat();

  const hostId =
    role === 'host' ? selfId : Object.values(peers).find((p) => p.isHost)?.id ?? null;

  const sendableCount =
    hostId == null
      ? 0
      : Object.values(files).filter(
          (e) => e.senderId === selfId && e.localState === 'local' && !e.holders.includes(hostId)
        ).length;

  const retryBar = status === 'failed';

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="bg-gradient-to-r from-bifrost-300 to-bifrost-600 bg-clip-text text-2xl font-bold text-transparent">
          Bifrost
          <span className="ml-2 align-middle text-[10px] font-normal tracking-normal text-slate-600">
            build {__BUILD.slice(11, 19)} UTC
          </span>
        </h1>
        <div className="flex items-center gap-4">
          <ConnectionStatusBadge />
          <button className="btn-secondary" onClick={() => session.leave()}>
            <LogOut className="h-4 w-4" /> Leave
          </button>
        </div>
      </header>

      {retryBar && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-red-950/60 px-4 py-2 text-sm text-red-200">
          <span>{useSessionStore.getState().statusMessage || 'Connection lost.'}</span>
          <button className="btn-primary shrink-0" onClick={() => session.retryConnection()}>
            Retry
          </button>
        </div>
      )}

      <SaveFolderPrompt />
      <InviteLinkBar />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
        <aside className="flex flex-col gap-4">
          <ParticipantsPanel />
          {role === 'guest' && (
            <button
              className="btn-primary w-full justify-center"
              disabled={sendableCount === 0}
              title={sendableCount === 0 ? 'Nothing to send — the host has all your files' : undefined}
              onClick={() => session.sendAllToHost()}
            >
              <Send className="h-4 w-4" /> Send All{sendableCount > 0 ? ` (${sendableCount})` : ''}
            </button>
          )}
          {role === 'host' && (
            <div className="card p-3 text-xs text-slate-500">
              You are hosting. Files others send land in your save folder; everyone can
              download files you hold.
            </div>
          )}
          <button
            className="btn-secondary w-full justify-center"
            disabled
            title="Files already on your device are marked in the pool"
          >
            <ArrowDownToLine className="h-4 w-4" /> Downloads appear here
          </button>
        </aside>

        <main className="flex flex-col gap-4">
          <TransferPanel />
          <FilePoolList />
        </main>
      </div>
    </div>
  );
}

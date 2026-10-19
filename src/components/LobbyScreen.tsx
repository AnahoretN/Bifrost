import { Link2, PlugZap } from 'lucide-react';
import { session } from '../p2p/sessionController';

/**
 * Pre-connection screen: the full UI is visible but disabled — only
 * "Connect" is active. Clicking it creates the room and the invite link.
 */
export default function LobbyScreen() {
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-bifrost-300 via-bifrost-400 to-bifrost-600 bg-clip-text text-5xl font-bold text-transparent">
          Bifrost
        </h1>
        <p className="mt-2 text-slate-400">
          P2P file bridge over the BitTorrent network — transfer 10 GB+ files directly
          between devices.
        </p>
      </div>

      <div className="card w-full max-w-2xl p-6 opacity-60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800">
              <Link2 className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-500">Room</div>
              <div className="text-xs text-slate-600">Create a room to get a shareable link</div>
            </div>
          </div>
          <div className="h-9 w-40 rounded-lg bg-slate-800/70" />
        </div>

        <div className="mt-6 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-16 items-center gap-3 rounded-lg bg-slate-800/40 px-3">
              <div className="h-10 w-10 rounded bg-slate-800/80" />
              <div className="flex-1">
                <div className="h-3 w-1/3 rounded bg-slate-800/80" />
                <div className="mt-2 h-2 w-1/5 rounded bg-slate-800/60" />
              </div>
              <div className="h-8 w-24 rounded bg-slate-800/60" />
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => void session.connectAsHost()}
        className="btn-primary px-8 py-3 text-base shadow-lg shadow-bifrost-600/20"
      >
        <PlugZap className="h-5 w-5" />
        Connect — create a room
      </button>
      <p className="max-w-md text-center text-xs text-slate-600">
        Guests join with the link this creates. Everyone in a room shares one file pool;
        files are sent to the host and can be downloaded by anyone.
      </p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { session } from './p2p/sessionController';
import { useSessionStore } from './store/sessionStore';
import { roomIdFromUrl } from './utils/inviteLink';
import { loadSavedFolder, queryFolderPermission, storageMode } from './storage/fileSystemAccess';
import { rescanDirectory } from './storage/directoryIndex';
import LobbyScreen from './components/LobbyScreen';
import RoomScreen from './components/RoomScreen';
import JoinNameDialog from './components/JoinNameDialog';
import ConnectOverlay from './components/ConnectOverlay';
import UnsupportedBrowserBanner from './components/UnsupportedBrowserBanner';

export default function App() {
  const status = useSessionStore((s) => s.status);
  const [inviteRoomId, setInviteRoomId] = useState<string | null>(null);
  const [askName, setAskName] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    // Restore the save-folder handle + refresh its permission verdict, then
    // index whatever is already on disk (presence detection).
    void (async () => {
      await loadSavedFolder();
      await queryFolderPermission();
      await rescanDirectory();
      setStorageReady(true);
    })();

    // Host announces on unload so guests reconnect immediately (45s watchdog
    // would otherwise time the loss out).
    const onPageHide = () => session.announceReloading();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  useEffect(() => {
    // A ?roomId= link means guest flow — same URL-precedence rule as the
    // reference app: the link overrides whatever local state exists.
    const roomId = roomIdFromUrl();
    if (roomId && status === 'lobby') {
      setInviteRoomId(roomId);
      setAskName(true);
    }
  }, [status]);

  if (!storageReady) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <UnsupportedBrowserBanner mode={storageMode()} />
      {status === 'lobby' && inviteRoomId && askName && (
        <JoinNameDialog
          onJoin={(name) => {
            setAskName(false);
            session.setSelfName(name);
            void session.joinAsGuest(inviteRoomId, name);
          }}
          onCancel={() => setAskName(false)}
        />
      )}
      {status === 'lobby' && <LobbyScreen />}
      {(status === 'connecting' || status === 'reconnecting') && (
        <ConnectOverlay status={useSessionStore.getState().statusMessage} />
      )}
      {(status === 'connected' || status === 'failed') && <RoomScreen />}
    </div>
  );
}

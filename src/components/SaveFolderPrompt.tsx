import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import {
  canWrite,
  pickSaveFolder,
  queryFolderPermission,
  regrantFolder,
  storageMode,
  loadSavedFolder,
} from '../storage/fileSystemAccess';
import { rescanDirectory } from '../storage/directoryIndex';

/**
 * Banner shown until a save destination is available. Re-granting a persisted
 * handle needs a user gesture, so this stays a button — never an auto-prompt.
 */
export default function SaveFolderPrompt() {
  const [needs, setNeeds] = useState(false);
  const [hasSavedHandle, setHasSavedHandle] = useState(false);

  useEffect(() => {
    void (async () => {
      setHasSavedHandle(!!(await loadSavedFolder()));
      setNeeds(storageMode() === 'fs-access' && !canWrite());
    })();
  });

  if (!needs || storageMode() !== 'fs-access') return null;

  const pick = async () => {
    if (hasSavedHandle) {
      await regrantFolder();
    } else {
      await pickSaveFolder();
    }
    await queryFolderPermission();
    await rescanDirectory();
    setNeeds(!canWrite());
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-bifrost-950/60 px-4 py-2 text-sm">
      <span className="text-bifrost-200">
        Pick a folder where received files should be saved — transfers start once it&apos;s
        granted.
      </span>
      <button className="btn-primary shrink-0" onClick={() => void pick()}>
        <FolderOpen className="h-4 w-4" />
        {hasSavedHandle ? 'Re-allow folder' : 'Choose folder'}
      </button>
    </div>
  );
}

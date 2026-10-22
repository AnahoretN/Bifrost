// Export a file stored in app-private storage (OPFS) to the user.
// Android: Web Share API (straight into Gallery/Files). Desktop browsers
// without FS Access (Firefox): classic download via an object URL.

import { createLogger } from '../utils/logger';
import { findHandle } from './directoryIndex';

const log = createLogger('export');

export async function exportLocalFile(name: string, size: number): Promise<'shared' | 'downloaded' | 'failed'> {
  const handle = findHandle(name, size);
  if (!handle) {
    log.warn(`export: no handle for "${name}"`);
    return 'failed';
  }
  try {
    const file = await handle.getFile();
    // Web Share (Android/Chrome): hands the file to the OS share sheet.
    if (typeof navigator.canShare === 'function') {
      try {
        const shareData = { files: [file] };
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return 'shared';
        }
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return 'shared'; // user closed the sheet
        log.warn('navigator.share failed, falling back to download:', e);
      }
    }
    // Classic download.
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'downloaded';
  } catch (e) {
    log.error('export failed:', e);
    return 'failed';
  }
}

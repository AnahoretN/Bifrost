// Preview dispatcher: file type → generator. Returns JPEG bytes or null
// (generic icon). Failure NEVER blocks the pool entry.

import { imagePreview } from './imagePreview';
import { psdPreview } from './psdPreview';
import { videoPreview } from './videoPreview';

export function isPreviewable(name: string, mime: string): boolean {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return (
    ext === 'psd' ||
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)
  );
}

export async function generatePreview(file: File): Promise<Uint8Array | null> {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const mime = file.type || '';
  try {
    if (ext === 'psd') return await psdPreview(file);
    if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) {
      return await videoPreview(file);
    }
    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
      return await imagePreview(file);
    }
  } catch {
    return null;
  }
  return null;
}

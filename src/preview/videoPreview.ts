// Video preview: load metadata, seek ~10% in (max 5s), grab the frame.
// Codec gaps (common on mobile) fail fast to the generic-icon path.

import { VIDEO_SEEK_TIMEOUT_MS } from '../constants';
import { canvasToJpeg, drawToPreviewCanvas } from './imagePreview';

export async function videoPreview(file: File): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = url;

  try {
    await waitFor(video, 'loadeddata', VIDEO_SEEK_TIMEOUT_MS);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return null;
    video.currentTime = Math.min(duration * 0.1, 5);
    await waitFor(video, 'seeked', VIDEO_SEEK_TIMEOUT_MS);
    const canvas = drawToPreviewCanvas(video, video.videoWidth, video.videoHeight);
    if (!canvas) return null;
    return await canvasToJpeg(canvas);
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function waitFor(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error(`video ${event} failed`));
    };
    const timer = setTimeout(fail, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', fail, { once: true });
  });
}

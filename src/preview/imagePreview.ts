// Image preview: decode + canvas downscale to ≤256px JPEG.

import {
  PREVIEW_JPEG_QUALITY,
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_SIDE,
} from '../constants';

export function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return resolve(null);
        let bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length > PREVIEW_MAX_BYTES) {
          // Re-encode lower quality once; below that, give up gracefully.
          const q = Math.max(0.3, PREVIEW_JPEG_QUALITY * (PREVIEW_MAX_BYTES / bytes.length));
          const downgraded = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, 'image/jpeg', q)
          );
          if (downgraded) bytes = new Uint8Array(await downgraded.arrayBuffer());
        }
        resolve(bytes);
      },
      'image/jpeg',
      PREVIEW_JPEG_QUALITY
    );
  });
}

/** Draw a bitmap source into a ≤256px canvas. Returns null for degenerate sizes. */
export function drawToPreviewCanvas(
  source: ImageBitmap | HTMLCanvasElement | HTMLVideoElement,
  srcW: number,
  srcH: number
): HTMLCanvasElement | null {
  if (srcW <= 0 || srcH <= 0) return null;
  const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

export async function imagePreview(file: File): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = drawToPreviewCanvas(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    if (!canvas) return null;
    return await canvasToJpeg(canvas);
  } catch {
    return null;
  }
}

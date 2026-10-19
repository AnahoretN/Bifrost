// PSD preview via ag-psd: read the composite image only (skip layer data),
// downscale to the shared preview canvas. Multi-GB PSDs are skipped — the
// generic icon fallback covers them.

import { readPsd } from 'ag-psd';
import { PSD_PREVIEW_MAX_FILE } from '../constants';
import { canvasToJpeg, drawToPreviewCanvas } from './imagePreview';

export async function psdPreview(file: File): Promise<Uint8Array | null> {
  if (file.size > PSD_PREVIEW_MAX_FILE) return null;
  try {
    // useImageData:false → ag-psd renders the composite onto a canvas.
    const psd = readPsd(await file.arrayBuffer(), {
      skipLayerImageData: true,
      skipThumbnail: true,
      useImageData: false,
    });
    const canvas = psd.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return null;
    const preview = drawToPreviewCanvas(canvas, canvas.width, canvas.height);
    if (!preview) return null;
    return await canvasToJpeg(preview);
  } catch {
    return null;
  }
}

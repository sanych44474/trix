// Browser-side file prep for uploads: photos are redrawn at most 1280 px on the long side as
// JPEG (a phone photo is 3–8 MB; the AI needs far less), video length is read from the clip's
// own header before upload.
import { fitWithin, mp4Seconds } from "../logic/media";

export async function shrinkImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file; // older WebViews without createImageBitmap: send as is
  }
}

export async function videoSeconds(file: Blob): Promise<number | undefined> {
  try { return mp4Seconds(new Uint8Array(await file.arrayBuffer())); } catch { return undefined; }
}

/** Draw a photo into a canvas for an on-screen preview (no object URL in the DOM). */
export async function drawPreview(file: Blob, canvas: HTMLCanvasElement): Promise<void> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, 720);
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
  } catch { /* no preview on WebViews without createImageBitmap */ }
}

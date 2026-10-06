// Browser-side file prep for uploads: photos are redrawn at most 1280 px on the long side as
// JPEG (a phone photo is 3–8 MB; the AI needs far less), video length is read before upload.
import { fitWithin } from "../logic/media";

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

export function videoSeconds(file: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (s?: number) => { URL.revokeObjectURL(url); resolve(s); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : undefined);
    v.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 4000);
    v.src = url;
  });
}

import { compressImage } from "@/lib/image/compress";

export const MAX_GUEST_PHOTOS = 6;
export const MAX_GUEST_PHOTO_BYTES = 600 * 1024;
export const MAX_GUEST_REQUEST_BYTES = 4 * 1024 * 1024;

/** Fit a whole six-photo post comfortably inside the app's request limit. */
export async function prepareGuestPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error("Choose a photo from your camera or photo library.");
  }
  if (file.size > 30 * 1024 * 1024) throw new Error("That photo is too large. Try a smaller photo.");
  try {
    for (const [dimension, quality] of [[1600, 0.82], [1600, 0.65], [1600, 0.5], [1200, 0.6], [1000, 0.45]]) {
      const photo = await compressImage(file, dimension, quality);
      if (photo.size > 0 && photo.size <= MAX_GUEST_PHOTO_BYTES) return photo;
    }
  } catch {
    throw new Error("This phone couldn't open that photo. Try taking a new photo or choosing a JPEG.");
  }
  throw new Error("That photo is too large. Try a smaller photo.");
}

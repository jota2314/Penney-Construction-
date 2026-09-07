/** Signed storage URLs keep the filename in the path, before the token. */
export function isPdfAttachment(path?: string | null, mimeType?: string | null): boolean {
  if (mimeType?.split(";")[0].trim().toLowerCase() === "application/pdf") return true;
  const filename = (path ?? "").split(/[?#]/, 1)[0];
  try {
    return /\.pdf$/i.test(decodeURIComponent(filename));
  } catch {
    return /\.pdf$/i.test(filename);
  }
}

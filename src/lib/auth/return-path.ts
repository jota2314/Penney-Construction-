/** OAuth may return only to a path on this app, never an external host. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return null;
    const base = "https://penney.invalid";
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
export const AUTH_RETURN_PATH_COOKIE = "penney_auth_return_to";
export const AUTH_RETURN_COOKIE_PATH = "/auth/callback";

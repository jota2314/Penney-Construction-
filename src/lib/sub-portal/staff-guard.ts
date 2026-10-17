import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/get-user";

/**
 * The R1 stand-in for per-device sessions (plan §3.6): a browser that is
 * signed in to the Penney app as office staff must not act as a sub.
 *
 * The old "open as this sub" route left 60-day sub cookies in office
 * browsers, so an office tap could post, confirm dates or send invoices as
 * Marcio, and every look bumped his view counter. Staff use the read-only
 * Preview (/sub-preview/{id}) instead. Team phones signed in with a field
 * login keep working, and so does every sub phone (no Supabase session).
 *
 * Every sub-portal POST route calls this first; the portal GETs do too, so
 * an office browser never counts as a sub's visit.
 */
export const STAFF_BROWSER_ERROR = "You're signed in as Penney staff in this browser. Use Preview instead.";

// @supabase/ssr's session cookie, possibly split into .0/.1 chunks. The
// PKCE "-code-verifier" cookie alone isn't a session.
const AUTH_COOKIE = /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/i;

export async function refuseStaffBrowser(request: NextRequest): Promise<NextResponse | null> {
  // Cheap exit for every real sub phone: no Supabase session cookie at all.
  if (!request.cookies.getAll().some((c) => AUTH_COOKIE.test(c.name))) return null;

  // The middleware has already refreshed the session by now. The REAL
  // profile decides: Jorge's "View as field" is still Jorge in this browser.
  const user = await getUser().catch(() => null);
  const role = user?.realProfile?.role ?? null;
  if (!user || !role || role === "field") return null;

  return NextResponse.json({ error: STAFF_BROWSER_ERROR }, { status: 403 });
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  IMPERSONATION_ALLOWED_EMAIL,
  IMPERSONATION_COOKIE_NAME,
} from "@/lib/auth/impersonation-config";
import { canAccessPath } from "@/lib/auth/role-access";

const OFFICE_PREFIXES = [
  "/dashboard",
  "/projects",
  "/customers",
  "/estimates",
  "/subcontractors",
  "/settings",
  "/crm",
  "/site-visits",
  "/employees",
  "/schedule",
  "/mode-select",
  "/workflow",
  "/command-center",
  "/crew-admin",
  "/cost-book",
  "/meetings",
  "/hiring",
];

const CREW_PREFIXES = ["/crew/", "/crew"];

const ALL_PROTECTED = [...OFFICE_PREFIXES, ...CREW_PREFIXES];

const ALLOWED_DOMAIN = "penneyconstructioninc.com";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() verifies the JWT locally against the project's ES256 JWKS
  // (cached in-process) instead of round-tripping to /auth/v1/user on every
  // request. It still calls getSession() internally, so an expired access
  // token is refreshed and the new cookies are written through setAll above.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  const userEmail = typeof claims?.email === "string" ? claims.email : null;

  const pathname = request.nextUrl.pathname;

  // Role-based routing never applies to /api/* — no OFFICE_PREFIX or
  // CREW_PREFIX can match a path starting with "/api/" — so the profile
  // lookups below are pure overhead there. The allow-list check still runs:
  // it is a security gate, not routing, and must cover API requests too.
  const isApiRoute = pathname.startsWith("/api/");

  // Everything the decisions below need, fetched in one parallel batch
  // rather than three sequential awaits.
  const needsAllowListCheck =
    !!userId &&
    !!userEmail &&
    !pathname.startsWith("/unauthorized") &&
    !userEmail.endsWith(`@${ALLOWED_DOMAIN}`);

  const impersonateId = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value;

  const [allowedRes, profileRes, impersonatedRes] = await Promise.all([
    needsAllowListCheck
      ? // Check allowed_emails using service role for reliable access.
        createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          {
            cookies: {
              getAll() { return []; },
              setAll() {},
            },
          }
        )
          .from("allowed_emails")
          .select("id")
          .eq("email", userEmail!)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId && !isApiRoute
      ? supabase.from("profiles").select("role, email").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    // Only speculative when the cookie is actually set (View-as), and the
    // result is discarded below unless the real profile passes that gate.
    userId && !isApiRoute && impersonateId
      ? supabase.from("profiles").select("role, email").eq("id", impersonateId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Block unauthorized emails — company domain auto-allowed, others checked against allowed_emails
  if (needsAllowListCheck && !allowedRes.data) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "unauthorized_domain");
    return NextResponse.redirect(url);
  }

  // Past the security gate, everything left is page routing. API routes
  // handle their own authorization and are never redirected here.
  if (isApiRoute) {
    return supabaseResponse;
  }

  // Protected routes: redirect to login if not authenticated
  if (
    !userId &&
    ALL_PROTECTED.some((prefix) => pathname.startsWith(prefix))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Role-based routing for authenticated users
  if (userId) {
    const realProfile = profileRes.data as { role?: string | null; email?: string | null } | null;

    // Honor the impersonation cookie so "View as Field" actually routes Jorge
    // through the field-worker experience.
    let role: string | null | undefined = realProfile?.role;
    let effectiveEmail: string | null | undefined =
      realProfile?.email ?? userEmail;
    if (
      impersonateId &&
      realProfile?.email?.toLowerCase() === IMPERSONATION_ALLOWED_EMAIL
    ) {
      const imp = impersonatedRes.data as { role?: string | null; email?: string | null } | null;
      if (imp) {
        role = imp.role;
        effectiveEmail = imp.email ?? effectiveEmail;
      }
    }

    const isFieldWorker = role === "field";

    // Redirect authenticated users away from login
    if (pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = isFieldWorker ? "/crew" : "/command-center";
      return NextResponse.redirect(url);
    }

    // Field workers trying to access office routes → redirect to /crew
    if (isFieldWorker && OFFICE_PREFIXES.some((p) => pathname.startsWith(p))) {
      const url = request.nextUrl.clone();
      url.pathname = "/crew";
      return NextResponse.redirect(url);
    }

    // Office users trying to access /crew → redirect to /command-center
    // But NOT /crew-admin (that's an office route)
    if (!isFieldWorker && (pathname === "/crew" || pathname.startsWith("/crew/")) && !pathname.startsWith("/crew-admin")) {
      const url = request.nextUrl.clone();
      url.pathname = "/command-center";
      return NextResponse.redirect(url);
    }

    // Role/email-restricted routes: PM blocked prefixes, Jorge-only /ceo,
    // reviewer-only /command-center/reviews (uses the impersonation-resolved
    // identity so View-as previews this correctly).
    if (!canAccessPath({ role, email: effectiveEmail }, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/command-center";
      return NextResponse.redirect(url);
    }
  }

  // Redirect /dashboard to /command-center
  if (pathname === "/dashboard") {
    const url = request.nextUrl.clone();
    url.pathname = "/command-center";
    return NextResponse.redirect(url);
  }

  // Redirect /mode-select to /command-center
  if (pathname === "/mode-select") {
    const url = request.nextUrl.clone();
    url.pathname = "/command-center";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

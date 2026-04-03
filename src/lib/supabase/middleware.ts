import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
  "/command-center",
  "/crew-admin",
  "/cost-book",
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Block unauthorized emails — company domain auto-allowed, others checked against allowed_emails
  if (
    user &&
    user.email &&
    !pathname.startsWith("/unauthorized")
  ) {
    const isCompanyDomain = user.email.endsWith(`@${ALLOWED_DOMAIN}`);
    if (!isCompanyDomain) {
      // Check allowed_emails table using service role for reliable access
      const adminSupabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          cookies: {
            getAll() { return []; },
            setAll() {},
          },
        }
      );
      const { data: allowed } = await adminSupabase
        .from("allowed_emails")
        .select("id")
        .eq("email", user.email)
        .single();

      if (!allowed) {
        await supabase.auth.signOut();
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("error", "unauthorized_domain");
        return NextResponse.redirect(url);
      }
    }
  }

  // Protected routes: redirect to login if not authenticated
  if (
    !user &&
    ALL_PROTECTED.some((prefix) => pathname.startsWith(prefix))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Role-based routing for authenticated users
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role;
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

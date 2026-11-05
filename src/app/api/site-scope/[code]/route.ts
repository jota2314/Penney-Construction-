import { NextRequest, NextResponse } from "next/server";
import { getGuestJobScope } from "@/lib/site-qr/guest-scope";
import { buildGuestScopePdf, guestScopePdfFilename, GuestScopePdfError } from "@/lib/site-qr/guest-scope-pdf";

export const runtime = "nodejs";
export const maxDuration = 30;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/** Possession of this open job's printed code grants this read-only document. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: PRIVATE_HEADERS });
  if (request.headers.has("next-action")) return error("This link only opens the job scope.", 405);
  const filters = request.nextUrl.searchParams.getAll("trade");
  if (filters.length > 1) return error("Choose one trade for the scope.", 400);
  try {
    const { code } = await params;
    const scope = await getGuestJobScope(code);
    if (!scope) return error("This job code isn't active. Please scan the sign again.", 404);
    const trade = filters.length ? filters[0] : null;
    const bytes = buildGuestScopePdf(scope, trade);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${guestScopePdfFilename(scope, trade)}"`,
      },
    });
  } catch (cause) {
    if (cause instanceof GuestScopePdfError) return error(cause.message, cause.status);
    console.error("[site-scope] Could not prepare scope", cause);
    return error("The scope couldn't load. Please try again.", 503);
  }
}

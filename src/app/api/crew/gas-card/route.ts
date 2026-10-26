import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  const user = await getUser();
  if (!user) {
    return new Response("Sign in to view the gas card.", { status: 401, headers });
  }
  // Match the crew layout's effective role, including authorized View As sessions.
  if (user.profile?.role !== "field") {
    return new Response("Crew access required.", { status: 403, headers });
  }

  // The original photo lives in private storage, never in public assets or source.
  const { data: image, error } = await createAdminClient().storage
    .from("crew-resources")
    .download("bjs-gas-card.jpg");
  if (error || !image) {
    return new Response("The gas card is temporarily unavailable.", { status: 503, headers });
  }
  return new Response(image, {
    headers: { ...headers, "Content-Type": "image/jpeg" },
  });
}

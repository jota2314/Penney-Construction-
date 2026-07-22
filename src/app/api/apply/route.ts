import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public job-application intake. Anonymous applicants have no Supabase
// session, so RLS on job_applications blocks a normal client insert — we
// write through the service role here instead. Runs on Node so the
// service-role key stays server-side.
export const runtime = "nodejs";

const ROLES = new Set(["coordinator", "ai_ops"]);

// Only the fields an applicant fills in. status/reviewed_* stay at their
// DB defaults so a hostile POST can't set itself to "offer".
const ALLOWED_FIELDS = [
  "full_name",
  "email",
  "phone",
  "whatsapp",
  "location",
  "english_level",
  "years_construction",
  "years_tech",
  "linkedin_url",
  "portfolio_url",
  "available_est",
  "expected_salary",
  "cover_note",
] as const;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const role = typeof body.role === "string" ? body.role.trim() : "";
    const fullName =
      typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (!fullName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "A valid email is required" },
        { status: 400 }
      );
    }

    const record: Record<string, unknown> = { role };
    for (const field of ALLOWED_FIELDS) {
      const value = body[field];
      if (value === undefined || value === null) continue;
      if (field === "available_est") {
        record[field] = Boolean(value);
      } else if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) record[field] = trimmed;
      }
    }
    // Normalize the required fields to the trimmed versions we validated.
    record.full_name = fullName;
    record.email = email.toLowerCase();

    const supabase = createAdminClient();
    const { error } = await supabase.from("job_applications").insert(record);

    if (error) {
      console.error("apply insert error:", error);
      return NextResponse.json(
        { error: "Could not submit your application. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("apply route error:", error);
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Public job-application intake. Anonymous applicants have no Supabase
// session, so RLS on job_applications blocks a normal client insert — we
// write through the service role here instead. Runs on Node so the
// service-role key stays server-side and so we can stream the resume
// upload to Storage.
export const runtime = "nodejs";

const ROLES = new Set(["coordinator", "ai_ops"]);

const RESUME_BUCKET = "job-applications";
const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors the bucket limit.
const RESUME_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Only the fields an applicant fills in. status/reviewed_* stay at their
// DB defaults so a hostile POST can't set itself to "offer".
const TEXT_FIELDS = [
  "phone",
  "whatsapp",
  "location",
  "english_level",
  "years_construction",
  "years_tech",
  "linkedin_url",
  "portfolio_url",
  "expected_salary",
  "cover_note",
] as const;

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return base || "resume";
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();

    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v.trim() : "";
    };

    const role = str("role");
    const fullName = str("full_name");
    const email = str("email");

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

    const record: Record<string, unknown> = {
      role,
      full_name: fullName,
      email: email.toLowerCase(),
      available_est: form.get("available_est") === "true",
    };
    for (const field of TEXT_FIELDS) {
      const value = str(field);
      if (value) record[field] = value;
    }

    const supabase = createAdminClient();

    // Optional resume upload — validate type/size, then store under a
    // random folder so filenames can't collide or overwrite.
    const resume = form.get("resume");
    if (resume && typeof resume !== "string" && resume.size > 0) {
      if (!RESUME_MIME.has(resume.type)) {
        return NextResponse.json(
          { error: "Resume must be a PDF or Word document" },
          { status: 400 }
        );
      }
      if (resume.size > MAX_RESUME_BYTES) {
        return NextResponse.json(
          { error: "Resume must be under 10 MB" },
          { status: 400 }
        );
      }
      const safeName = sanitizeFilename(resume.name);
      const path = `${crypto.randomUUID()}/${safeName}`;
      const bytes = new Uint8Array(await resume.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from(RESUME_BUCKET)
        .upload(path, bytes, { contentType: resume.type, upsert: false });
      if (uploadError) {
        console.error("resume upload error:", uploadError);
        return NextResponse.json(
          { error: "Could not upload your resume. Please try again." },
          { status: 500 }
        );
      }
      record.resume_path = path;
      record.resume_name = resume.name;
    }

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

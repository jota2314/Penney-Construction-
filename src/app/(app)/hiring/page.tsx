import type { Metadata } from "next";
import { headers } from "next/headers";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApplicationsBoard } from "@/components/hiring/applications-board";
import type { JobApplication } from "@/components/hiring/applications-board";

export const metadata: Metadata = { title: "Hiring | Penney Construction" };

// Resumes live in a private bucket; hand the reviewer a short-lived signed
// URL rather than exposing the bucket. Regenerated on each page load.
const RESUME_BUCKET = "job-applications";
const SIGNED_URL_TTL = 60 * 60; // 1 hour

export default async function HiringPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_applications")
    .select("*")
    .order("created_at", { ascending: false });

  const applications = (data ?? []) as JobApplication[];

  const resumeUrls: Record<string, string> = {};
  const withResumes = applications.filter((a) => a.resume_path);
  if (withResumes.length > 0) {
    const admin = createAdminClient();
    await Promise.all(
      withResumes.map(async (a) => {
        const { data: signed } = await admin.storage
          .from(RESUME_BUCKET)
          .createSignedUrl(a.resume_path as string, SIGNED_URL_TTL);
        if (signed?.signedUrl) resumeUrls[a.id] = signed.signedUrl;
      })
    );
  }

  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") || headersList.get("host") || "";
  const protocol = host.includes("localhost") ? "http" : "https";
  const applyUrl = host ? `${protocol}://${host}/apply` : "/apply";

  return (
    <>
      <Header title="Hiring" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <ApplicationsBoard
          applications={applications}
          applyUrl={applyUrl}
          resumeUrls={resumeUrls}
        />
      </div>
    </>
  );
}

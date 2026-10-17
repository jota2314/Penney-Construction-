import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SITE_OFFICE_PHONE,
  canManageSiteSigns,
  ensureProjectSiteCode,
  getSubPortalLoomUrl,
  isSiteOpen,
  siteUrl,
} from "@/lib/sub-portal/site-code";
import { isInternalJob } from "@/lib/crew/crew-visibility";
import { PROJECT_STATUS_LABELS } from "@/lib/constants/project";
import type { ProjectStatus } from "@/types/database";
import { SiteQrActions } from "@/components/site-qr/site-qr-actions";
import { SignPostedTick } from "@/components/site-qr/site-sign-controls";
import { BinderLabel, SignPage, SignRun, SiteSign, SiteSignPrintStyles } from "@/components/site-qr/site-sign";

export const metadata: Metadata = { title: "Job QR | Penney Construction" };

type JobRow = {
  id: string;
  name: string;
  project_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  status: string;
  is_overhead: boolean | null;
  site_sign_posted_at: string | null;
  site_sign_posted_by: string | null;
};

/**
 * /job-qr/{projectId} — one job's printable QR sign (entry door) plus its
 * binder-cover label. Lives outside the (app) shell on purpose: no sidebar,
 * so it prints as clean letter pages. Opening it mints the job's site code
 * if it doesn't have one yet. Office roles only; a field login goes to /crew.
 * Every live job at once: /job-qr/all.
 */
export default async function JobQrPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (!canManageSiteSigns(user.profile?.role)) redirect("/crew");
  const { id } = await params;
  const admin = createAdminClient();

  const { data } = await admin
    .from("projects")
    .select("id, name, project_number, address, city, state, status, is_overhead, site_sign_posted_at, site_sign_posted_by")
    .eq("id", id)
    .maybeSingle();
  const project = data as JobRow | null;
  if (!project) notFound();

  const [code, loomUrl, posterRes] = await Promise.all([
    ensureProjectSiteCode(admin, project.id),
    getSubPortalLoomUrl(admin),
    project.site_sign_posted_by
      ? admin.from("profiles").select("full_name").eq("id", project.site_sign_posted_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const url = siteUrl(code);
  const open = isSiteOpen(project);
  const internal = isInternalJob(project);
  const address = [project.address, project.city, project.state].filter(Boolean).join(", ") || null;
  const statusName =
    PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? (project.status === "on_hold" ? "On hold" : project.status);
  const postedBy = (posterRes.data as { full_name: string | null } | null)?.full_name ?? null;
  const job = { name: project.name, project_number: project.project_number, address };

  return (
    <div className="min-h-screen bg-stone-100 px-4 py-6 text-stone-900 print:bg-white print:p-0">
      <SiteSignPrintStyles />
      <div className="mx-auto max-w-[8.5in] space-y-4">
        <SiteQrActions projectId={project.id} url={url} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-sm print:hidden">
          <p className="text-sm text-stone-600">
            Prints the door sign and a half-page binder label.{" "}
            <Link href="/job-qr/all" className="font-medium text-amber-700 underline underline-offset-2">
              All live job signs
            </Link>
          </p>
          <SignPostedTick projectId={project.id} postedAt={project.site_sign_posted_at} postedBy={postedBy} />
        </div>

        {!open && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
            {internal ? (
              <>This is an office job, so the QR says it isn&apos;t open for check-in.</>
            ) : (
              <>
                This job is <strong>{statusName}</strong>. Subs can only check in while a job is Contracted, In
                Progress or On Hold, so the QR will say the job isn&apos;t open until then.
              </>
            )}
          </p>
        )}

        <SignRun>
          <SignPage>
            <SiteSign job={job} url={url} loomUrl={loomUrl} officePhone={SITE_OFFICE_PHONE} />
          </SignPage>
          <SignPage>
            <BinderLabel job={job} url={url} officePhone={SITE_OFFICE_PHONE} />
          </SignPage>
        </SignRun>
      </div>
    </div>
  );
}

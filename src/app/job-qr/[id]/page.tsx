import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_OPEN_STATUSES, ensureProjectSiteCode, siteUrl } from "@/lib/sub-portal/site-code";
import { PROJECT_STATUS_LABELS } from "@/lib/constants/project";
import type { ProjectStatus } from "@/types/database";
import { QrCode } from "@/components/site-qr/qr-code";
import { SiteQrActions } from "@/components/site-qr/site-qr-actions";

export const metadata: Metadata = { title: "Job QR | Penney Construction" };

const OFFICE_PHONE = "978-621-4387";

/**
 * /job-qr/{projectId} — the printable job-site QR sign (window, binder
 * cover). Lives outside the (app) shell on purpose: no sidebar, so it prints
 * as one clean letter page. Opening it mints the job's site code if it
 * doesn't have one yet.
 */
export default async function JobQrPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, name, project_number, address, city, state, status")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const code = await ensureProjectSiteCode(admin, project.id);
  const url = siteUrl(code);
  const open = SITE_OPEN_STATUSES.includes(project.status);
  const address = [project.address, project.city, project.state].filter(Boolean).join(", ");
  const statusName = PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? project.status;

  return (
    <div className="min-h-screen bg-stone-100 px-4 py-6 text-stone-900 print:bg-white print:p-0">
      <style>{`@page { size: letter; margin: 0.45in; }`}</style>
      <div className="mx-auto max-w-[8.5in] space-y-4">
        <SiteQrActions projectId={project.id} url={url} />

        {!open && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
            This job is <strong>{statusName}</strong>. Subs can only check in while a job is Contracted, In
            Progress or On Hold, so the QR will say the job isn&apos;t open until then.
          </p>
        )}

        <section className="flex flex-col items-center rounded-xl bg-white px-10 py-10 text-center shadow-sm print:rounded-none print:px-0 print:py-0 print:shadow-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- print sheet: plain img prints reliably */}
          <img src="/logo.jpg" alt="Penney Construction, Inc." className="h-[1.15in] w-auto object-contain" />

          <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.35em] text-amber-700">Job check-in</p>
          <h1 className="mt-2 text-[34px] font-extrabold leading-tight">{project.name}</h1>
          <p className="mt-1 text-[15px] text-stone-600">
            {project.project_number}
            {address ? ` · ${address}` : ""}
          </p>

          <div className="mt-6 rounded-2xl border-[3px] border-stone-900 p-3">
            <QrCode value={url} title={`Check in at ${project.name}`} className="h-[4.1in] w-[4.1in]" />
          </div>

          <p className="mt-5 text-[24px] font-bold">Subcontractors: scan with your phone camera</p>
          <div className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-1 text-[17px] text-stone-700">
            <span>Clock in &amp; out</span>
            <span aria-hidden>·</span>
            <span>Post photos to the job</span>
            <span aria-hidden>·</span>
            <span>See the drawings</span>
          </div>
          <p className="mt-3 text-[15px] text-stone-600">
            First time? Sign up in a minute with your cell number and a 4-digit PIN.
          </p>

          <div className="mt-7 w-full border-t border-stone-300 pt-4 text-[13px] text-stone-500">
            <p>
              Penney crew: clock in from the Penney app. &nbsp;·&nbsp; Office {OFFICE_PHONE}
            </p>
            <p className="mt-1 font-mono text-[12px] tracking-wide text-stone-400">{url.replace("https://", "")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

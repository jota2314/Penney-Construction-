import { SiteJoin } from "@/components/sub-portal/site-join";
import Link from "next/link";
import type { Metadata } from "next";
import { CrewJobFolder } from "@/components/crew/crew-job-folder";
import { getTeamSiteJob } from "@/lib/site-qr/team-job";
import { UploadQueueBanner } from "@/components/schedule/upload-queue-banner";
import { GuestSitePhotos } from "@/components/site-qr/guest-site-photos";
import { createAdminClient } from "@/lib/supabase/admin";
import { findProjectBySiteCode, isSiteOpen, normalizeSiteCode } from "@/lib/sub-portal/site-code";
import { PortalHeader, PortalTheme } from "@/components/portal-kit";

export const metadata: Metadata = { title: "Job daily logs | Penney Construction", referrer: "no-referrer", robots: { index: false, follow: false } };

/**
 * Every printed QR opens the photo form immediately. Account-based project
 * tools are available only when someone explicitly chooses them.
 */
export default async function SubSiteQrPage({ params, searchParams }: {
  params: Promise<{ code: string }>;
  searchParams?: Promise<{ tools?: string }>;
}) {
  const { code } = await params;
  const query = await searchParams;
  if (query?.tools !== "1") {
    const normalized = normalizeSiteCode(code);
    const project = normalized.length === 8
      ? await findProjectBySiteCode(createAdminClient(), normalized)
      : null;
    if (!project || !isSiteOpen(project)) {
      return (
        <PortalTheme variant="field">
          <PortalHeader title="Job photos" safeTop />
          <main className="mx-auto max-w-md space-y-4 px-4 py-6">
            <h1 className="text-xl font-extrabold">{project ? "This job isn't open for photos right now" : "This QR code isn't active"}</h1>
            <p className="text-[var(--muted)]">Call the Penney office and we&apos;ll help you get your pictures to the right job.</p>
            <a href="tel:9786214387" className="btn btn-primary btn-lg btn-block">Call the office</a>
          </main>
        </PortalTheme>
      );
    }
    return <GuestSitePhotos code={normalized} project={{ name: project.name, number: project.project_number, town: project.city }} />;
  }

  const team = await getTeamSiteJob(code);
  if (team.kind === "unavailable") {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-xl font-bold">This job isn&apos;t available to your account</h1>
        <p>Check the QR code or ask the Penney office for access.</p>
        <Link href="/login" className="underline">Open the Penney app</Link>
      </main>
    );
  }
  if (team.kind === "ready") {
    return (
      <main className="mx-auto min-h-screen max-w-3xl bg-background px-4 pb-10 pt-5 text-foreground">
        <Link href={team.backHref} className="mb-5 inline-block text-sm font-medium underline underline-offset-2">
          Back to the Penney app
        </Link>
        <CrewJobFolder jobs={[team.job]} initialJobId={team.job.id} siteMode />
        <UploadQueueBanner />
      </main>
    );
  }
  return <SiteJoin code={code} />;
}

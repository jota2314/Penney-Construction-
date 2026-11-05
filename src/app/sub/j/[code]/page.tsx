import { SiteJoin } from "@/components/sub-portal/site-join";
import Link from "next/link";
import type { Metadata } from "next";
import { CrewJobFolder } from "@/components/crew/crew-job-folder";
import { getTeamSiteJob } from "@/lib/site-qr/team-job";
import { UploadQueueBanner } from "@/components/schedule/upload-queue-banner";

export const metadata: Metadata = { title: "Job site | Penney Construction" };

/**
 * Keep every printed QR working. Team members open the scanned job with
 * their own identity; subcontractors keep the existing portal sign-in.
 */
export default async function SubSiteQrPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
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

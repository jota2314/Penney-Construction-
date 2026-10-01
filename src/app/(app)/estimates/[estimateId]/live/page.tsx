import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getProposalStamp } from "@/lib/estimates/proposal-stamp";
import { LiveProposalView } from "@/components/estimates/live-proposal-view";

export const metadata: Metadata = { title: "Live Proposal | Penney Construction" };

/**
 * Live Proposal: the client proposal PDF on screen, auto-refreshing within a
 * few seconds of any change to the estimate so Jorge can review while lines
 * are edited elsewhere (e.g. by Claude in the database).
 */
export default async function LiveProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ estimateId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAuth();
  const { estimateId } = await params;
  const { page } = await searchParams;
  const supabase = await createClient();

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, name, version, project_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (!estimate) notFound();

  const { data: project } = estimate.project_id
    ? await supabase
        .from("projects")
        .select("id, name, project_number")
        .eq("id", estimate.project_id)
        .maybeSingle()
    : { data: null };

  // The proposal PDF is generated per project; an estimate still attached
  // only to a lead has no client proposal to show yet.
  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          This estimate isn&apos;t linked to a project yet, so there&apos;s no client proposal to show.
        </p>
        <Link
          href={`/estimates/${estimate.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-500 hover:text-amber-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to estimate
        </Link>
      </div>
    );
  }

  const initial = await getProposalStamp(supabase, estimate.id);
  if (!initial) notFound();

  const initialPage = Math.min(99, Math.max(1, Number.parseInt(page ?? "", 10) || 1));

  return (
    <LiveProposalView
      estimate={{ id: estimate.id, name: estimate.name, version: estimate.version }}
      project={{ id: project.id, name: project.name, projectNumber: project.project_number }}
      initial={initial}
      initialPage={initialPage}
    />
  );
}

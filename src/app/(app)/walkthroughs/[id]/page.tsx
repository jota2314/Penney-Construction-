import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { WalkthroughDetail } from "@/components/walkthroughs/walkthrough-detail";

export const metadata: Metadata = { title: "Walkthrough Details | Penney Construction" };

export default async function WalkthroughDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: walkthrough }, { data: notes }, { data: files }] =
    await Promise.all([
      supabase.from("walkthroughs").select("*").eq("id", id).single(),
      supabase
        .from("walkthrough_notes")
        .select("*")
        .eq("walkthrough_id", id)
        .order("sort_order"),
      supabase
        .from("walkthrough_files")
        .select("*")
        .eq("walkthrough_id", id)
        .order("created_at"),
    ]);

  if (!walkthrough) notFound();

  // Project type drives the checklist. Walkthroughs link to a project
  // directly or through their estimate.
  let projectType: string | null = null;
  let projectId: string | null = walkthrough.project_id;
  if (!projectId && walkthrough.estimate_id) {
    const { data: est } = await supabase.from("estimates").select("project_id").eq("id", walkthrough.estimate_id).single();
    projectId = est?.project_id ?? null;
  }
  if (projectId) {
    const { data: p } = await supabase.from("projects").select("project_type").eq("id", projectId).single();
    projectType = p?.project_type ?? null;
  }

  return (
    <>
      <Header title={`Walkthrough — ${walkthrough.name}`} backHref="/walkthroughs" backLabel="Walkthroughs" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
        <WalkthroughDetail
          walkthrough={walkthrough}
          notes={notes ?? []}
          files={files ?? []}
          projectType={projectType}
          hasEstimate={Boolean(walkthrough.estimate_id || projectId)}
        />
      </div>
    </>
  );
}

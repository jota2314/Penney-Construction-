import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { pickCurrentEstimate } from "@/lib/estimates/current";
import { ArrowLeft } from "lucide-react";
import { ProjectBudgetView } from "@/components/projects/project-budget-view";
import { getProjectLaborCost } from "@/lib/actions/labor-cost";
import { getLineCloseouts } from "@/lib/actions/line-closeout";

export const metadata: Metadata = { title: "Project Budget | Penney Construction" };

export default async function ProjectBudgetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (!project) notFound();

  // The current estimate + its line items — stamped contract estimate first,
  // else highest live version (one rule everywhere).
  const { data: estimates } = await supabase
    .from("estimates")
    .select("*")
    .eq("project_id", id)
    .order("version", { ascending: false });

  const latestEstimate = pickCurrentEstimate(
    estimates ?? [],
    (project as { contract_estimate_id?: string | null }).contract_estimate_id ?? null,
  );

  const laborCost = await getProjectLaborCost(id);

  // Close-outs carry the line price alongside realized cost and margin, so the
  // breakdown reads off them directly rather than re-querying the lines.
  const closeouts = latestEstimate
    ? await getLineCloseouts(id, latestEstimate.id)
    : [];

  return (
    <>
      <Header title="Budget" backHref={`/projects/${id}`} backLabel="Project" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
        <Link
          href={`/projects/${id}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          {project.project_number} — {project.name}
        </Link>

        <ProjectBudgetView
          project={project}
          projectId={id}
          estimateName={latestEstimate?.name ?? null}
          closeouts={closeouts}
          laborCost={laborCost}
        />
      </div>
    </>
  );
}

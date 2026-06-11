import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import { ProjectBudgetView } from "@/components/projects/project-budget-view";

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

  // Get latest estimate + its line items
  const { data: estimates } = await supabase
    .from("estimates")
    .select("*")
    .eq("project_id", id)
    .order("version", { ascending: false })
    .limit(1);

  const latestEstimate = estimates?.[0] ?? null;

  let lineItems: { description: string; total_price: number }[] = [];
  if (latestEstimate) {
    const { data } = await supabase
      .from("estimate_line_items")
      .select("description, total_price, client_price")
      .eq("estimate_id", latestEstimate.id)
      .order("sort_order");
    // client_price (active set) wins; total_price is the legacy mirror.
    lineItems = (data ?? []).map((li) => ({
      description: li.description,
      total_price: Number(li.client_price ?? li.total_price ?? 0),
    }));
  }

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
          estimateName={latestEstimate?.name ?? null}
          lineItems={lineItems}
        />
      </div>
    </>
  );
}

import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EstimateBuilder } from "@/components/estimates/estimate-builder";

export default async function StandaloneEstimatePage({
  params,
}: {
  params: Promise<{ estimateId: string }>;
}) {
  await requireAuth();
  const { estimateId } = await params;
  const supabase = await createClient();

  // Fetch estimate + line items + files
  const [{ data: estimate }, { data: lineItems }, { data: estimateFiles }] =
    await Promise.all([
      supabase.from("estimates").select("*").eq("id", estimateId).single(),
      supabase
        .from("estimate_line_items")
        .select("*")
        .eq("estimate_id", estimateId)
        .order("sort_order"),
      supabase
        .from("estimate_files")
        .select("*")
        .eq("estimate_id", estimateId)
        .order("created_at"),
    ]);

  if (!estimate) notFound();

  // If this estimate has a project_id, load project context
  let projectContext = null;
  if (estimate.project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select(
        "id, name, project_number, project_type, address, city, state, description, customer_id, customers(first_name, last_name)"
      )
      .eq("id", estimate.project_id)
      .single();

    if (project) {
      projectContext = {
        projectId: project.id,
        projectName: project.name,
        projectNumber: project.project_number,
        projectType: project.project_type,
        projectAddress:
          [project.address, project.city, project.state]
            .filter(Boolean)
            .join(", ") || null,
        projectDescription: project.description,
        customerName:
          Array.isArray(project.customers) && project.customers.length > 0
            ? `${project.customers[0].first_name} ${project.customers[0].last_name}`
            : null,
      };
    }
  }

  // If this estimate has a lead_id, load lead context (+ latest meeting summary)
  let leadContext = null;
  if (estimate.lead_id) {
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", estimate.lead_id)
      .single();

    if (lead) {
      // Get latest completed meeting summary for this lead
      const { data: latestMeeting } = await supabase
        .from("meetings")
        .select("summary")
        .eq("lead_id", lead.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      leadContext = {
        leadId: lead.id,
        leadNumber: lead.lead_number,
        clientName: `${lead.first_name} ${lead.last_name}`,
        address:
          [lead.address, lead.city, lead.state].filter(Boolean).join(", ") ||
          null,
        projectType: lead.project_type,
        description: lead.description,
        budgetMin: lead.budget_min,
        budgetMax: lead.budget_max,
        meetingSummary: latestMeeting?.summary ?? null,
      };
    }
  }

  const headerTitle = estimate.name;

  return (
    <>
      <Header title={headerTitle} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <EstimateBuilder
          estimate={estimate}
          lineItems={lineItems ?? []}
          projectContext={projectContext}
          leadContext={leadContext}
          estimateFiles={estimateFiles ?? []}
        />
      </div>
    </>
  );
}

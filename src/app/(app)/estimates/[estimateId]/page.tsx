import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EstimateBuilder } from "@/components/estimates/estimate-builder";
import { getTradeRatesForAI } from "@/lib/actions/trade-rates";
import { getMeetingQAForEstimate } from "@/lib/actions/meeting-questions";

export const metadata: Metadata = { title: "Estimate Builder | Penney Construction" };

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

  // If this estimate has a project_id, load project context + sibling versions
  let projectContext = null;
  let siblingEstimates: { id: string; version: number; name: string; total_price: number; status: string }[] = [];
  if (estimate.project_id) {
    const { data: sibs } = await supabase
      .from("estimates")
      .select("id, version, name, total_price, status")
      .eq("project_id", estimate.project_id)
      .order("version");
    siblingEstimates = sibs ?? [];
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

  // If this estimate has a lead_id, load lead context (+ latest meeting summary + Q&A)
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
        .select("id, summary")
        .eq("lead_id", lead.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get Q&A from the meeting if available
      let meetingQA: string | null = null;
      if (latestMeeting?.id) {
        meetingQA = await getMeetingQAForEstimate(latestMeeting.id);
      }

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
        meetingQA,
      };
    }
  }

  // Fetch linked site visits + their notes for this estimate
  let siteVisitContext: { name: string; summary: string | null; notes: string[] }[] = [];
  const { data: linkedVisits } = await supabase
    .from("site_visits")
    .select("id, name, summary")
    .eq("estimate_id", estimateId)
    .order("visited_at", { ascending: false });

  if (linkedVisits && linkedVisits.length > 0) {
    const visitIds = linkedVisits.map((v) => v.id);
    const { data: visitNotes } = await supabase
      .from("site_visit_notes")
      .select("site_visit_id, content")
      .in("site_visit_id", visitIds)
      .order("sort_order");

    siteVisitContext = linkedVisits.map((v) => ({
      name: v.name ?? "Site Visit",
      summary: v.summary,
      notes: (visitNotes ?? [])
        .filter((n) => n.site_visit_id === v.id)
        .map((n) => n.content),
    }));
  }

  // Fetch trade rates for AI pricing (filtered by project type if available)
  const estimateProjectType =
    projectContext?.projectType ?? leadContext?.projectType ?? null;
  const tradeRates = await getTradeRatesForAI(estimateProjectType);

  const headerTitle = estimate.name;

  return (
    <>
      <Header title={headerTitle} backHref="/estimates" backLabel="Estimates" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <EstimateBuilder
          estimate={estimate}
          lineItems={lineItems ?? []}
          projectContext={projectContext}
          leadContext={leadContext}
          estimateFiles={estimateFiles ?? []}
          siteVisitContext={siteVisitContext.length > 0 ? siteVisitContext : undefined}
          tradeRates={tradeRates}
          siblingEstimates={siblingEstimates}
        />
      </div>
    </>
  );
}

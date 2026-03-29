import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EstimateBuilder } from "@/components/estimates/estimate-builder";
import { getTradeRatesForAI } from "@/lib/actions/trade-rates";

export const metadata: Metadata = { title: "Project Estimate | Penney Construction" };

export default async function EstimateBuilderPage({
  params,
}: {
  params: Promise<{ id: string; estimateId: string }>;
}) {
  await requireAuth();
  const { id: projectId, estimateId } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: estimate }, { data: lineItems }, { data: estimateFiles }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, project_number, project_type, address, city, state, description, customer_id, customers(first_name, last_name)")
        .eq("id", projectId)
        .single(),
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

  if (!project || !estimate) notFound();

  const projectContext = {
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

  const tradeRates = await getTradeRatesForAI(project.project_type);

  return (
    <>
      <Header title={`${project.project_number} - ${estimate.name}`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <EstimateBuilder
          estimate={estimate}
          lineItems={lineItems ?? []}
          projectContext={projectContext}
          estimateFiles={estimateFiles ?? []}
          tradeRates={tradeRates}
        />
      </div>
    </>
  );
}

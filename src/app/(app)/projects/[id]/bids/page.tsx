import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ProjectBidsBoard } from "@/components/projects/project-bids-board";
import { getCurrentEstimate } from "@/lib/estimates/current-estimate";

export const metadata: Metadata = { title: "Bids | Penney Construction" };

export default async function ProjectBidsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  // The line item is the spine — load every line for the latest estimate, then everything that hangs off it.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, address, city, state, scope_of_work")
    .eq("id", id)
    .single();
  if (!project) notFound();

  const estimate = await getCurrentEstimate<{ id: string; name: string; version: number }>(
    supabase,
    id,
    "id, name, version"
  );

  const lineItemsPromise = estimate
    ? supabase
        .from("estimate_line_items")
        .select(`
          id, description, scope_text, trade, quantity, unit, total_cost, total_price,
          needs_sub_quote, awarded_bid_id, awarded_subcontractor_id, awarded_cost, awarded_at,
          awarded_sub:subcontractors!awarded_subcontractor_id ( id, company_name )
        `)
        .eq("estimate_id", estimate.id)
        .order("trade", { ascending: true })
        .order("description", { ascending: true })
    : Promise.resolve({ data: [] as unknown[] });

  const [lineItemsRes, bidsRes, quotesRes] = await Promise.all([
    lineItemsPromise,
    supabase
      .from("subcontractor_bids")
      .select(`
        id, bid_package_id, estimate_line_item_id, subcontractor_id, amount, status, is_selected,
        sent_at, submitted_at, resent_count, gmail_message_id,
        subcontractors ( id, company_name, contact_name, email, phone ),
        bid_packages!inner ( id, project_id, trade, due_date, status )
      `)
      .eq("bid_packages.project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("quote_requests")
      .select("id, estimate_line_item_id, subcontractor_id, subcontractor_name, trade, amount, status, scope_description, document_type, attachment_storage_path, sent_at, received_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <Header title={`Bids — ${project.name}`} backHref={`/projects/${id}`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <ProjectBidsBoard
          project={project}
          estimate={estimate}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lineItems={(lineItemsRes.data ?? []) as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          bids={(bidsRes.data ?? []) as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          quotes={(quotesRes.data ?? []) as any[]}
        />
      </div>
    </>
  );
}

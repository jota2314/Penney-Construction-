import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getBidPackages } from "@/lib/actions/bids";
import { ProjectBidsAndQuotes } from "@/components/projects/project-bids-and-quotes";

export const metadata: Metadata = { title: "Bids & Quotes | Penney Construction" };

export default async function QuotesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: quotes }, { data: estimates }, bidPackages] = await Promise.all([
    supabase.from("projects").select("id, name, address, city, state, project_type, scope_of_work").eq("id", id).single(),
    supabase
      .from("quote_requests")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("estimates")
      .select("id, name, total_price, estimate_line_items(id, description, trade, total_price, needs_sub_quote)")
      .eq("project_id", id)
      .order("version", { ascending: false })
      .limit(1),
    getBidPackages(id),
  ]);

  if (!project) notFound();

  // Get trades that need quotes from the latest estimate
  const latestEstimate = estimates?.[0];
  const tradesNeedingQuotes = latestEstimate?.estimate_line_items
    ?.filter((li: { needs_sub_quote: boolean; trade: string | null }) => li.needs_sub_quote && li.trade)
    .map((li: { trade: string; description: string; total_price: number }) => ({
      trade: li.trade,
      description: li.description,
      estimatedPrice: li.total_price,
    })) ?? [];

  return (
    <>
      <Header title={`Bids & Quotes — ${project.name}`} backHref={`/projects/${id}/estimates`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <ProjectBidsAndQuotes
          project={project}
          quotes={quotes ?? []}
          bidPackages={bidPackages}
          tradesNeedingQuotes={tradesNeedingQuotes}
        />
      </div>
    </>
  );
}

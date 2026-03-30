import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { LeadDetail } from "@/components/leads/lead-detail";

export const metadata: Metadata = { title: "Lead Details | Penney Construction" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: lead }, { data: meetings }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).single(),
    supabase
      .from("meetings")
      .select("*")
      .eq("lead_id", id)
      .order("scheduled_at", { ascending: false }),
  ]);

  if (!lead) notFound();

  return (
    <>
      <Header title={lead.lead_number} backHref="/crm/leads" backLabel="Leads" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <LeadDetail lead={lead} meetings={meetings ?? []} />
      </div>
    </>
  );
}

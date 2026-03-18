import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { CrmStats } from "@/components/crm/crm-stats";
import { CrmPipelineView } from "@/components/crm/crm-pipeline-view";
import { CrmHeader } from "@/components/crm/crm-header";

export default async function CrmPage() {
  await requireAuth();
  const supabase = await createClient();

  const now = new Date().toISOString();
  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString();

  const [
    { count: newLeadCount },
    { count: upcomingMeetingCount },
    { count: convertedCount },
    { data: leads },
    { data: meetings },
    { data: recentEstimates },
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("status", "new"),
    supabase
      .from("meetings")
      .select("*", { count: "exact", head: true })
      .eq("status", "scheduled")
      .gte("scheduled_at", now),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("status", "converted")
      .gte("updated_at", startOfMonth),
    supabase
      .from("leads")
      .select("*")
      .not("status", "in", '("converted","lost")')
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("meetings")
      .select("*, lead:leads(first_name, last_name)")
      .eq("status", "scheduled")
      .gte("scheduled_at", now)
      .order("scheduled_at")
      .limit(10),
    supabase
      .from("estimates")
      .select("*, lead:leads!estimates_lead_id_fkey(first_name, last_name, lead_number)")
      .is("project_id", null)
      .in("status", ["draft", "review"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <>
      <Header title="CRM" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <CrmHeader />

        <CrmStats
          newLeads={newLeadCount ?? 0}
          upcomingMeetings={upcomingMeetingCount ?? 0}
          converted={convertedCount ?? 0}
        />

        <CrmPipelineView
          leads={leads ?? []}
          meetings={meetings ?? []}
          recentEstimates={recentEstimates ?? []}
        />
      </div>
    </>
  );
}

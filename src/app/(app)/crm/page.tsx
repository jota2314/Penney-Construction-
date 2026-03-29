import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { CrmStats } from "@/components/crm/crm-stats";
import { CrmHeader } from "@/components/crm/crm-header";

export const metadata: Metadata = { title: "CRM | Penney Construction" };

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
  ]);

  return (
    <>
      <Header title="CRM" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <CrmHeader />

        <CrmStats
          newLeads={newLeadCount ?? 0}
          upcomingMeetings={upcomingMeetingCount ?? 0}
          converted={convertedCount ?? 0}
        />
      </div>
    </>
  );
}

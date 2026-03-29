import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { MeetingList } from "@/components/meetings/meeting-list";

export const metadata: Metadata = { title: "Meetings | Penney Construction" };

export default async function MeetingsPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: meetings } = await supabase
    .from("meetings")
    .select("*, lead:leads(lead_number, first_name, last_name)")
    .order("scheduled_at", { ascending: false });

  return (
    <>
      <Header title="Meetings" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Meetings</h2>
          <p className="text-muted-foreground text-sm">
            Site visits and consultations.
          </p>
        </div>
        <MeetingList meetings={meetings ?? []} />
      </div>
    </>
  );
}

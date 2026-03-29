import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { MeetingDetail } from "@/components/meetings/meeting-detail";

export const metadata: Metadata = { title: "Meeting Details | Penney Construction" };

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: meeting }, { data: notes }, { data: files }, { data: questions }] =
    await Promise.all([
      supabase.from("meetings").select("*").eq("id", id).single(),
      supabase
        .from("meeting_notes")
        .select("*")
        .eq("meeting_id", id)
        .order("sort_order"),
      supabase
        .from("meeting_files")
        .select("*")
        .eq("meeting_id", id)
        .order("created_at"),
      supabase
        .from("meeting_questions")
        .select("*")
        .eq("meeting_id", id)
        .order("sort_order"),
    ]);

  if (!meeting) notFound();

  // Fetch lead and linked walkthrough in parallel
  const [{ data: lead }, { data: walkthrough }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", meeting.lead_id).single(),
    supabase
      .from("walkthroughs")
      .select("id")
      .eq("meeting_id", id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!lead) notFound();

  return (
    <>
      <Header
        title={`Meeting — ${lead.first_name} ${lead.last_name}`}
        backHref="/crm/meetings"
        backLabel="Meetings"
      />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <MeetingDetail
          meeting={meeting}
          lead={lead}
          notes={notes ?? []}
          files={files ?? []}
          questions={questions ?? []}
          walkthroughId={walkthrough?.id}
        />
      </div>
    </>
  );
}

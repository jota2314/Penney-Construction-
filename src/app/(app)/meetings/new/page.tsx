import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { NewMeetingForm } from "@/components/meetings/new-meeting-form";

export const metadata: Metadata = { title: "New Meeting | Penney Construction" };

export default async function NewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  await requireAuth();
  const { project } = await searchParams;
  const supabase = await createClient();

  // Active jobs first; RLS scopes this to the PM's projects automatically.
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, project_number, status")
    .in("status", ["contracted", "in_progress", "proposal_sent", "estimating", "lead"])
    .order("status")
    .order("name");

  return (
    <>
      <Header title="Record a Meeting" backHref="/meetings" backLabel="Meetings" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 pb-24 sm:p-6">
        <p className="text-sm text-muted-foreground">
          Pick the job, hit record, and talk — the whole conversation gets
          transcribed. When you finish, the AI writes the meeting summary and
          pulls out the action items for you to review.
        </p>
        <NewMeetingForm
          projects={(projects ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            project_number: p.project_number,
          }))}
          preselectedProjectId={project}
        />
      </div>
    </>
  );
}

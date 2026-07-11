import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ClientMeetingCapture } from "@/components/meetings/client-meeting-capture";
import type { ProjectMeeting } from "@/lib/actions/project-meetings";

export const metadata: Metadata = { title: "Meeting | Penney Construction" };

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const { data: meeting } = await supabase
    .from("project_meetings")
    .select(
      "*, project:projects(id, name, customer:customers(first_name, last_name))"
    )
    .eq("id", id)
    .single();

  if (!meeting) notFound();

  const project = meeting.project as unknown as {
    id: string;
    name: string;
    customer: { first_name: string | null; last_name: string | null } | null;
  } | null;
  const clientName =
    [project?.customer?.first_name, project?.customer?.last_name]
      .filter(Boolean)
      .join(" ") || null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { project: _p, ...meetingRow } = meeting;

  return (
    <>
      <Header
        title={meeting.title || "Client Meeting"}
        backHref="/meetings"
        backLabel="Meetings"
      />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 pb-24 sm:p-6 max-w-2xl">
        <ClientMeetingCapture
          meeting={meetingRow as ProjectMeeting}
          projectName={project?.name ?? "Project"}
          clientName={clientName}
        />
      </div>
    </>
  );
}

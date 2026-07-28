import { notFound } from "next/navigation";
import { MeetingRunner } from "@/components/eos/meeting-runner";
import {
  getEosContext,
  getMeeting,
  listAttendees,
  listHeadlines,
  listIssues,
  listMeasurables,
  listRocks,
  listTodos,
} from "@/lib/eos/queries";
import { recentWeeks, weekEnding } from "@/lib/constants/eos";

export default async function EosMeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const { id } = await params;
  const meeting = await getMeeting(ctx, id);
  if (!meeting) notFound();

  const thisWeek = weekEnding(new Date(`${meeting.meetingDate}T00:00:00Z`));

  const [attendees, rocks, measurables, issues, todos, headlines] =
    await Promise.all([
      listAttendees(ctx, meeting.id),
      listRocks(ctx),
      listMeasurables(ctx, recentWeeks(2, new Date(`${meeting.meetingDate}T00:00:00Z`))),
      listIssues(ctx),
      listTodos(ctx),
      listHeadlines(ctx, meeting.id),
    ]);

  return (
    <MeetingRunner
      meeting={meeting}
      attendees={attendees}
      rocks={rocks}
      measurables={measurables}
      issues={issues}
      todos={todos}
      headlines={headlines}
      people={ctx.people}
      viewerId={ctx.viewerId}
      thisWeek={thisWeek}
    />
  );
}

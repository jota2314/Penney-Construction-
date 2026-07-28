import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StartMeetingButton } from "@/components/eos/start-meeting-button";
import { MeetingCadenceForm } from "@/components/eos/meeting-cadence-form";
import { getEosContext, getLiveMeeting, listMeetings } from "@/lib/eos/queries";
import { L10_TOTAL_MINUTES } from "@/lib/constants/eos";
import { cn } from "@/lib/utils";

function durationMinutes(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

export default async function EosMeetingsPage() {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const [meetings, live] = await Promise.all([
    listMeetings(ctx),
    getLiveMeeting(ctx),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Level 10 Meetings</h2>
          <p className="text-sm text-muted-foreground">
            Seven sections, {L10_TOTAL_MINUTES} minutes, run the same way every week.
          </p>
        </div>
        <StartMeetingButton liveMeetingId={live?.id ?? null} />
      </div>

      <MeetingCadenceForm
        meetingDay={ctx.team.meetingDay}
        meetingTime={ctx.team.meetingTime}
      />

      {meetings.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No Level 10s yet. Homework before Vision Building Day 1 is to run
            two or three of these.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {meetings.map((meeting) => {
            const minutes = durationMinutes(meeting.startedAt, meeting.endedAt);
            return (
              <Link key={meeting.id} href={`/eos/meetings/${meeting.id}`}>
                <Card className="transition-colors hover:border-amber-500/50">
                  <CardContent className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{meeting.meetingDate}</p>
                        {meeting.status === "in_progress" && (
                          <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500">
                            Running
                          </Badge>
                        )}
                        {meeting.status === "scheduled" && (
                          <Badge variant="secondary" className="text-[10px]">
                            Scheduled
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {minutes !== null ? `${minutes} min` : "—"}
                        {meeting.cascadingMessage
                          ? ` · ${meeting.cascadingMessage.slice(0, 80)}`
                          : ""}
                      </p>
                    </div>
                    {meeting.avgRating !== null && (
                      <span
                        className={cn(
                          "shrink-0 text-sm font-semibold tabular-nums",
                          meeting.avgRating >= 8
                            ? "text-emerald-500"
                            : "text-amber-500",
                        )}
                      >
                        {meeting.avgRating}
                        <span className="text-xs font-normal text-muted-foreground">
                          /10
                        </span>
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

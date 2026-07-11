import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, ChevronRight } from "lucide-react";

export const metadata: Metadata = { title: "Client Meetings | Penney Construction" };

export default async function MeetingsPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: meetings } = await supabase
    .from("project_meetings")
    .select("id, title, meeting_date, status, summary, project:projects(name, project_number)")
    .order("meeting_date", { ascending: false })
    .limit(100);

  return (
    <>
      <Header title="Client Meetings" backHref="/command-center" backLabel="Command Center" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 pb-24 sm:p-6">
        <Button asChild size="lg" className="w-full sm:w-auto sm:self-start">
          <Link href="/meetings/new">
            <Mic className="mr-2 h-4 w-4" /> Record a meeting
          </Link>
        </Button>

        {(meetings ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No meetings yet. Tap “Record a meeting” when you sit down with a client.
          </p>
        ) : (
          <div className="space-y-2">
            {(meetings ?? []).map((m) => {
              const project = m.project as unknown as {
                name: string;
                project_number: string;
              } | null;
              return (
                <Link key={m.id} href={`/meetings/${m.id}`} className="block">
                  <Card className="hover:bg-muted/40 transition">
                    <CardContent className="py-3 px-4 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {m.title || project?.name || "Meeting"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {project?.name}
                          {project?.project_number ? ` · ${project.project_number}` : ""}
                          {" · "}
                          {new Date(m.meeting_date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          m.status === "completed"
                            ? "text-green-600 dark:text-green-400 border-green-500/40"
                            : "text-amber-600 dark:text-amber-400 border-amber-500/40"
                        }
                      >
                        {m.status === "completed" ? "Saved" : "In progress"}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

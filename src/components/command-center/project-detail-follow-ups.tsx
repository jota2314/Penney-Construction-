"use client";

import { Button } from "@/components/ui/button";
import { updateFollowUpStatus } from "@/lib/actions/command-center";
import type { FollowUp } from "@/types/database";
import { useRouter } from "next/navigation";

interface ProjectDetailFollowUpsProps {
  followUps: FollowUp[];
}

export function ProjectDetailFollowUps({
  followUps,
}: ProjectDetailFollowUpsProps) {
  const router = useRouter();

  async function handleDone(id: string) {
    await updateFollowUpStatus(id, "done");
    router.refresh();
  }

  if (followUps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No open follow-ups for this project.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {followUps.map((followUp) => (
        <div
          key={followUp.id}
          className="rounded-lg border p-3 flex items-center justify-between gap-3"
        >
          <p className="text-sm flex-1">
            {followUp.contact_name} &mdash; {followUp.description}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            >
              Draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDone(followUp.id)}
            >
              Done
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

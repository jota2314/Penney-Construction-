"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startMeeting } from "@/lib/actions/eos-meetings";

export function StartMeetingButton({
  liveMeetingId,
  todayDoneId,
  className,
  size = "default",
}: {
  /** When a meeting is already running, this button joins it instead. */
  liveMeetingId?: string | null;
  /** Today's L10 is already finished — open it rather than offering to start. */
  todayDoneId?: string | null;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);

    const existing = liveMeetingId ?? todayDoneId;
    if (existing) {
      router.push(`/eos/meetings/${existing}`);
      return;
    }

    startTransition(async () => {
      const result = await startMeeting();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/eos/meetings/${result.data.id}`);
    });
  }

  return (
    <div className={className}>
      <Button onClick={go} disabled={pending} size={size} className="gap-2">
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : liveMeetingId || todayDoneId ? (
          <ArrowRight className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {liveMeetingId
          ? "Rejoin Level 10"
          : todayDoneId
            ? "Open today's Level 10"
            : "Start Level 10"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}

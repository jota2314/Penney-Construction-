"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startMeeting } from "@/lib/actions/eos-meetings";

export function StartMeetingButton({
  liveMeetingId,
  className,
  size = "default",
}: {
  /** When a meeting is already running, this button joins it instead. */
  liveMeetingId?: string | null;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);

    if (liveMeetingId) {
      router.push(`/eos/meetings/${liveMeetingId}`);
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
        ) : liveMeetingId ? (
          <ArrowRight className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {liveMeetingId ? "Rejoin Level 10" : "Start Level 10"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}

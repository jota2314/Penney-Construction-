"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * A dropped request reaches here as the browser's own wording — Safari says
 * "Load failed", Chrome "Failed to fetch". On a phone that reads as the app
 * breaking, and it hides the thing that actually matters: the save may well
 * have landed and only the reply been lost, so the next tap can double-file.
 * Name those for what they are and say what to do.
 */
const NETWORK_ERROR = /load failed|failed to fetch|networkerror|network request failed|aborted/i;

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const offline = NETWORK_ERROR.test(error.message ?? "");

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 px-6">
      <AlertTriangle className="h-12 w-12 text-amber-500" />
      <h2 className="text-xl font-semibold text-center">
        {offline ? "Couldn't reach the app" : "Something went wrong"}
      </h2>
      <p className="text-muted-foreground text-center max-w-md">
        {offline
          ? "The connection dropped before the page finished loading. If you had just saved something, it probably went through — reload and check before doing it again."
          : error.message || "An unexpected error occurred. Please try again."}
      </p>
      <Button onClick={reset} variant="outline">
        {offline ? "Reload" : "Try again"}
      </Button>
    </div>
  );
}

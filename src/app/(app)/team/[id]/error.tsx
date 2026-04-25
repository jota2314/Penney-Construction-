"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <h2 className="text-xl font-semibold mb-2">Couldn&apos;t load this team member</h2>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        {error.message || "Unknown error"}
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground mb-4">Digest: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/team"
          className="px-4 py-2 border rounded-md text-sm hover:bg-muted"
        >
          Back to Team
        </Link>
      </div>
    </div>
  );
}

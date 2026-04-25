"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { stopImpersonating } from "@/lib/auth/impersonation";
import { Eye, X } from "lucide-react";

interface Props {
  impersonatingName: string;
  impersonatingRole: string | null;
}

export function ImpersonationBanner({ impersonatingName, impersonatingRole }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleStop() {
    startTransition(async () => {
      await stopImpersonating();
      router.refresh();
    });
  }

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-center gap-3 text-sm font-medium sticky top-0 z-50 shadow-md">
      <Eye className="h-4 w-4 shrink-0" />
      <span className="truncate">
        Viewing as <span className="font-bold">{impersonatingName}</span>
        {impersonatingRole && (
          <span className="opacity-80"> · {impersonatingRole}</span>
        )}
      </span>
      <button
        type="button"
        onClick={handleStop}
        disabled={pending}
        className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/10 hover:bg-amber-950/20 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
        {pending ? "Exiting..." : "Exit"}
      </button>
    </div>
  );
}

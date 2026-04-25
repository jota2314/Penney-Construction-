"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startImpersonating } from "@/lib/auth/impersonation";
import { Eye } from "lucide-react";

interface Props {
  profileId: string;
  fullName: string;
}

export function ImpersonateButton({ profileId, fullName }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await startImpersonating(profileId);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push("/command-center");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={handleClick} disabled={pending} title={`View the app as ${fullName}`}>
        <Eye className="h-4 w-4 mr-2" />
        {pending ? "Loading..." : "View as user"}
      </Button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

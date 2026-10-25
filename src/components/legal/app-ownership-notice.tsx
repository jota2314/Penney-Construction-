import Link from "next/link";
import { APP_COPYRIGHT, APP_OWNERSHIP_STATEMENT } from "@/lib/app-ownership";
import { cn } from "@/lib/utils";

export function AppOwnershipNotice({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-1 text-center text-xs leading-relaxed text-muted-foreground", className)}>
      <p>
        <Link
          href="/terms#application-ownership"
          className="underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          {APP_OWNERSHIP_STATEMENT}
        </Link>
      </p>
      <p>{APP_COPYRIGHT}</p>
    </div>
  );
}

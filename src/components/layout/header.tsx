"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ArrowLeft } from "lucide-react";

interface HeaderProps {
  title?: string;
  /** Small label shown above the title (e.g. project number) */
  subtitle?: string;
  /** Destination for the contextual back link. */
  backHref?: string;
  backLabel?: string;
}

function resolveSafeReturnUrl(raw: string | null, fallback?: string): string | undefined {
  if (!raw) return fallback;

  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
  } catch {
    // Ignore malformed URI sequences and use the configured fallback.
  }

  return fallback;
}

export function Header({ title, subtitle, backHref, backLabel = "Back" }: HeaderProps) {
  const searchParams = useSearchParams();
  const resolvedBack = resolveSafeReturnUrl(
    searchParams.get("returnUrl"),
    backHref
  );

  return (
    <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b px-4">
      <SidebarTrigger className="-ml-1 hidden md:flex" />
      <Separator orientation="vertical" className="mr-2 h-4 hidden md:block" />
      {resolvedBack && (
        <Link
          href={resolvedBack}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Back to ${backLabel}`}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{backLabel}</span>
        </Link>
      )}
      {title && (
        <div className="min-w-0 flex-1">
          {subtitle && (
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">{subtitle}</p>
          )}
          <h1 className="text-sm font-semibold truncate leading-tight">{title}</h1>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />
        <ThemeToggle />
      </div>
    </header>
  );
}

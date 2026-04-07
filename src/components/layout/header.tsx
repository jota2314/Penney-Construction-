"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { X } from "lucide-react";

interface HeaderProps {
  title?: string;
  /** Small label shown above the title (e.g. project number) */
  subtitle?: string;
  /** Shows an X button that navigates to this URL (like closing the page) */
  backHref?: string;
  backLabel?: string;
}

export function Header({ title, subtitle, backHref }: HeaderProps) {
  const searchParams = useSearchParams();
  // If returnUrl is in the URL, use that instead of the hardcoded backHref
  const returnUrl = searchParams.get("returnUrl");
  const resolvedBack = returnUrl ? decodeURIComponent(returnUrl) : backHref;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1 hidden md:flex" />
      <Separator orientation="vertical" className="mr-2 h-4 hidden md:block" />
      {title && (
        <div className="min-w-0">
          {subtitle && (
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">{subtitle}</p>
          )}
          <h1 className="text-sm font-semibold truncate leading-tight">{title}</h1>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        {resolvedBack && (
          <Link
            href={resolvedBack}
            className="ml-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Close"
          >
            <X className="h-5 w-5" />
          </Link>
        )}
      </div>
    </header>
  );
}

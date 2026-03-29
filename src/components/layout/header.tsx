import Link from "next/link";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChevronLeft } from "lucide-react";

interface HeaderProps {
  title?: string;
  backHref?: string;
  backLabel?: string;
}

export function Header({ title, backHref, backLabel }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      {backHref && (
        <Link
          href={backHref}
          className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors mr-1"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{backLabel || "Back"}</span>
        </Link>
      )}
      {title && (
        <h1 className="text-sm font-medium truncate">{title}</h1>
      )}
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  );
}

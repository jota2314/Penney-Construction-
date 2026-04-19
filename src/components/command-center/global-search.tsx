"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FolderOpen, Mail, FileText, Users, HardHat, FileSpreadsheet, Paperclip, Loader2 } from "lucide-react";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { globalSearch, type SearchResult, type SearchGroup } from "@/lib/actions/global-search";

const GROUP_ORDER: SearchGroup[] = [
  "projects",
  "estimates",
  "quotes",
  "emails",
  "files",
  "customers",
  "subcontractors",
];

const GROUP_LABELS: Record<SearchGroup, string> = {
  projects: "Projects",
  estimates: "Estimates",
  quotes: "Quotes",
  emails: "Emails",
  files: "Files",
  customers: "Customers",
  subcontractors: "Subcontractors",
};

const GROUP_ICONS: Record<SearchGroup, React.ComponentType<{ className?: string }>> = {
  projects: FolderOpen,
  estimates: FileSpreadsheet,
  quotes: FileText,
  emails: Mail,
  files: Paperclip,
  customers: Users,
  subcontractors: HardHat,
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  // ⌘K / ctrl+K to open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset query when closing
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      try {
        const res = await globalSearch(trimmed);
        if (id === requestId.current) {
          setResults(res.results);
        }
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const grouped = useMemo(() => {
    const byGroup: Partial<Record<SearchGroup, SearchResult[]>> = {};
    for (const r of results) {
      (byGroup[r.group] ||= []).push(r);
    }
    return byGroup;
  }, [results]);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= 2;

  return (
    <>
      {/* Visible bar */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card/80 px-4 py-3 text-left shadow-sm transition-all hover:border-amber-500/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
        aria-label="Search"
      >
        <Search className="h-5 w-5 text-muted-foreground group-hover:text-amber-500" />
        <span className="flex-1 text-sm text-muted-foreground">
          Search projects, emails, quotes, files…
        </span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          <span className="text-[13px] leading-none">⌘</span>K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>
              Search across projects, emails, quotes, files, customers, and more.
            </DialogDescription>
          </DialogHeader>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]]:px-3 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:rounded-lg"
          >
            <CommandInput
              placeholder="Search projects, emails, quotes, files, customers…"
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
            <CommandList className="max-h-[60vh]">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  Searching…
                </div>
              )}

              {!loading && !hasQuery && (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  <Search className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
                  Type at least 2 characters to search everything.
                </div>
              )}

              {!loading && hasQuery && results.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No results for <span className="font-medium">&quot;{query}&quot;</span>
                </div>
              )}

              {!loading &&
                GROUP_ORDER.map((g) => {
                  const items = grouped[g];
                  if (!items || items.length === 0) return null;
                  const Icon = GROUP_ICONS[g];
                  return (
                    <CommandGroup key={g} heading={GROUP_LABELS[g]}>
                      {items.map((r) => (
                        <CommandItem
                          key={`${r.group}-${r.id}`}
                          value={`${r.group}-${r.id}`}
                          onSelect={() => handleSelect(r.href)}
                          className="flex items-start gap-3 py-2.5"
                        >
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium text-foreground">
                              {r.title}
                            </span>
                            {r.subtitle && (
                              <span className="truncate text-xs text-muted-foreground">
                                {r.subtitle}
                              </span>
                            )}
                            {r.meta && (
                              <span className="truncate text-[11px] text-muted-foreground/80">
                                {r.meta}
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

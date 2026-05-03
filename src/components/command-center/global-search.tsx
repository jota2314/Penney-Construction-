"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  FolderOpen,
  Mail,
  FileText,
  Users,
  HardHat,
  FileSpreadsheet,
  Paperclip,
  Loader2,
  Sparkles,
  Clock,
  ArrowUpRight,
} from "lucide-react";
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

const EXAMPLES = ["Kitchen", "PC-2026", "Beverly", "Peter"];
const RECENTS_KEY = "pcc_recent_searches";
const RECENTS_MAX = 5;

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(q: string) {
  if (typeof window === "undefined") return;
  const trimmed = q.trim();
  if (trimmed.length < 2) return;
  try {
    const current = loadRecents();
    const next = [trimmed, ...current.filter((x) => x.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENTS_MAX);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
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

  // Load recents when opening, reset query when closing
  useEffect(() => {
    if (open) {
      setRecents(loadRecents());
    } else {
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
      saveRecent(query);
      setOpen(false);
      router.push(href);
    },
    [router, query]
  );

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= 2;

  return (
    <>
      {/* Visible trigger bar */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
        style={{
          background: "var(--pcc-card, #16140F)",
          border: "1px solid var(--pcc-line, rgba(255,255,255,0.08))",
        }}
        aria-label="Search"
      >
        <div className="relative flex h-7 w-7 items-center justify-center">
          <Search className="h-[18px] w-[18px] text-amber-500/90 transition-colors group-hover:text-amber-400" />
          <Sparkles className="absolute -right-0.5 -top-0.5 h-3 w-3 text-amber-400/90" />
        </div>
        <span
          className="flex-1 truncate text-[14px]"
          style={{ color: "var(--pcc-muted, #A8A29E)" }}
        >
          Search anything…
        </span>
        <kbd
          className="hidden sm:inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-mono"
          style={{
            background: "var(--pcc-bg-2, #1A1814)",
            color: "var(--pcc-quiet, #6B655F)",
            border: "1px solid var(--pcc-line, rgba(255,255,255,0.08))",
          }}
        >
          <span className="text-[12px] leading-none">⌘</span>K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="overflow-hidden gap-0 p-0 max-w-full sm:max-w-2xl rounded-none sm:rounded-2xl border-0 sm:border top-0 left-0 translate-x-0 translate-y-0 sm:top-[10%] sm:left-1/2 sm:-translate-x-1/2 sm:translate-y-0 h-[100dvh] sm:h-auto bg-[#16140F] text-[#F5F1EA]"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>
              Search across projects, emails, quotes, files, customers, and more.
            </DialogDescription>
          </DialogHeader>
          <Command
            shouldFilter={false}
            className="bg-transparent text-[#F5F1EA] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-[#6B655F] [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]]:px-4 [&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-white/[0.06] [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input-wrapper]_svg]:text-amber-500/90 [&_[cmdk-input]]:h-14 [&_[cmdk-input]]:text-[15px] [&_[cmdk-input]]:placeholder:text-[#6B655F] [&_[cmdk-item]]:rounded-lg [&_[cmdk-item][data-selected=true]]:bg-amber-500/10"
          >
            <CommandInput
              placeholder="Search anything…"
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
            <CommandList className="max-h-[calc(100dvh-3.5rem)] sm:max-h-[60vh] py-2">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#A8A29E]">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  Searching…
                </div>
              )}

              {!loading && !hasQuery && (
                <div className="px-4 pt-3 pb-6 flex flex-col gap-5">
                  {recents.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B655F] px-1">
                        Recent
                      </div>
                      <div className="flex flex-col">
                        {recents.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setQuery(r)}
                            className="flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors hover:bg-white/[0.04]"
                          >
                            <Clock className="h-4 w-4 text-[#6B655F]" />
                            <span className="flex-1 truncate text-[14px] text-[#F5F1EA]">{r}</span>
                            <ArrowUpRight className="h-4 w-4 text-[#6B655F]" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B655F] px-1">
                      Try
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => setQuery(ex)}
                          className="rounded-full px-3 py-1.5 text-[13px] text-[#F5F1EA] bg-white/[0.04] border border-white/[0.06] hover:border-amber-500/40 hover:bg-amber-500/[0.08] transition-colors"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="text-[12px] text-[#6B655F] px-1 leading-relaxed">
                    Search projects, emails, quotes, files, customers, subs, and estimates — all at once.
                  </div>
                </div>
              )}

              {!loading && hasQuery && results.length === 0 && (
                <div className="py-12 text-center text-sm text-[#A8A29E]">
                  No results for <span className="font-medium text-[#F5F1EA]">&quot;{query}&quot;</span>
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
                          className="flex items-start gap-3 py-2.5 text-[#F5F1EA]"
                        >
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[14px] font-medium text-[#F5F1EA]">
                              {r.title}
                            </span>
                            {r.subtitle && (
                              <span className="truncate text-[12px] text-[#A8A29E]">
                                {r.subtitle}
                              </span>
                            )}
                            {r.meta && (
                              <span className="truncate text-[11px] text-[#6B655F]">
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

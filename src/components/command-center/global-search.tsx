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
  ChevronRight,
  CornerDownLeft,
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

const GROUP_TINT: Record<SearchGroup, { bg: string; fg: string }> = {
  projects:       { bg: "rgba(217,119,6,0.14)",  fg: "#F59E0B" },
  estimates:      { bg: "rgba(59,130,246,0.14)", fg: "#60A5FA" },
  quotes:         { bg: "rgba(52,211,153,0.14)", fg: "#34D399" },
  emails:         { bg: "rgba(167,139,250,0.14)",fg: "#A78BFA" },
  files:          { bg: "rgba(244,114,182,0.14)",fg: "#F472B6" },
  customers:      { bg: "rgba(34,211,238,0.14)", fg: "#22D3EE" },
  subcontractors: { bg: "rgba(251,146,60,0.14)", fg: "#FB923C" },
};

type QuickAction = { label: string; hint: string; href: string; icon: React.ComponentType<{ className?: string }>; tint: SearchGroup };
const QUICK_ACTIONS: QuickAction[] = [
  { label: "Projects",      hint: "Active jobs",   href: "/projects",                icon: FolderOpen,      tint: "projects" },
  { label: "Inbox",         hint: "Unread emails", href: "/command-center/emails",   icon: Mail,            tint: "emails" },
  { label: "Estimates",     hint: "In progress",   href: "/estimates",               icon: FileSpreadsheet, tint: "estimates" },
  { label: "Subcontractors",hint: "Vetted subs",   href: "/subcontractors",          icon: HardHat,         tint: "subcontractors" },
];

const EXAMPLES = ["Kitchen", "PC-2026", "Beverly", "Peter Nguyen"];
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

  useEffect(() => {
    if (open) {
      setRecents(loadRecents());
    } else {
      setQuery("");
      setResults([]);
    }
  }, [open]);

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

  const goTo = useCallback(
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
      {/* Trigger bar */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 active:scale-[0.99]"
        style={{
          background:
            "linear-gradient(180deg, rgba(217,119,6,0.05) 0%, rgba(22,20,15,0.6) 60%)",
          border: "1px solid rgba(217,119,6,0.18)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -16px rgba(217,119,6,0.35)",
        }}
        aria-label="Search"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-500/25">
          <Search className="h-[18px] w-[18px] text-amber-400" />
          <Sparkles className="absolute -right-1 -top-1 h-3 w-3 text-amber-300 drop-shadow-[0_0_4px_rgba(245,158,11,0.6)]" />
        </span>
        <span className="flex flex-1 flex-col leading-tight min-w-0">
          <span className="text-[14px] font-medium" style={{ color: "var(--pcc-ink, #F5F1EA)" }}>
            Search anything
          </span>
          <span className="text-[11px] truncate" style={{ color: "var(--pcc-quiet, #6B655F)" }}>
            Projects, emails, quotes, files…
          </span>
        </span>
        <kbd
          className="hidden sm:inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[10px] font-mono"
          style={{
            background: "var(--pcc-bg-2, #1A1814)",
            color: "var(--pcc-muted, #A8A29E)",
            border: "1px solid var(--pcc-line, rgba(255,255,255,0.08))",
          }}
        >
          <span className="text-[12px] leading-none">⌘</span>K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="overflow-hidden gap-0 p-0 max-w-full sm:max-w-[640px] rounded-none sm:rounded-3xl border-0 sm:border sm:border-white/[0.08] top-0 left-0 translate-x-0 translate-y-0 sm:top-[8%] sm:left-1/2 sm:-translate-x-1/2 sm:translate-y-0 h-[100dvh] sm:h-auto bg-[rgba(22,20,15,0.92)] text-[#F5F1EA] backdrop-blur-2xl shadow-[0_30px_120px_-20px_rgba(0,0,0,0.7)]"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>
              Search across projects, emails, quotes, files, customers, and more.
            </DialogDescription>
          </DialogHeader>

          {/* Mobile drag indicator */}
          <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
            <div className="h-1 w-10 rounded-full bg-white/15" />
          </div>

          <Command
            shouldFilter={false}
            className="bg-transparent text-[#F5F1EA] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-[#6B655F] [&_[cmdk-group]]:px-3 [&_[cmdk-input-wrapper]]:px-4 [&_[cmdk-input-wrapper]]:gap-3 [&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-white/[0.06] [&_[cmdk-input-wrapper]_svg]:hidden [&_[cmdk-input]]:h-16 [&_[cmdk-input]]:text-[16px] [&_[cmdk-input]]:placeholder:text-[#6B655F] [&_[cmdk-item]]:rounded-xl [&_[cmdk-item][data-selected=true]]:bg-amber-500/[0.08] [&_[cmdk-item][data-selected=true]]:ring-1 [&_[cmdk-item][data-selected=true]]:ring-amber-500/20"
          >
            <div className="relative flex items-center">
              <span className="absolute left-4 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-500/25 pointer-events-none">
                <Search className="h-[18px] w-[18px] text-amber-400" />
                <Sparkles className="absolute -right-1 -top-1 h-3 w-3 text-amber-300 drop-shadow-[0_0_4px_rgba(245,158,11,0.6)]" />
              </span>
              <CommandInput
                placeholder="Search anything…"
                value={query}
                onValueChange={setQuery}
                autoFocus
                className="!pl-16"
              />
              {loading && (
                <Loader2 className="absolute right-4 h-4 w-4 animate-spin text-amber-500" />
              )}
            </div>

            <CommandList className="max-h-[calc(100dvh-8rem)] sm:max-h-[64vh] py-3 [scrollbar-width:thin]">
              {!loading && !hasQuery && (
                <div className="px-4 pt-2 pb-6 flex flex-col gap-6">
                  {/* Quick actions */}
                  <div className="flex flex-col gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6B655F] px-1">
                      Jump to
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {QUICK_ACTIONS.map((qa) => {
                        const Icon = qa.icon;
                        const tint = GROUP_TINT[qa.tint];
                        return (
                          <button
                            key={qa.label}
                            type="button"
                            onClick={() => goTo(qa.href)}
                            className="group flex items-center gap-3 rounded-xl px-3 py-3 text-left bg-white/[0.025] border border-white/[0.06] hover:border-amber-500/30 hover:bg-white/[0.05] transition-all"
                          >
                            <span
                              className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
                              style={{ background: tint.bg, color: tint.fg }}
                            >
                              <Icon className="h-[18px] w-[18px]" />
                            </span>
                            <span className="flex flex-col min-w-0">
                              <span className="text-[13px] font-medium text-[#F5F1EA] truncate">
                                {qa.label}
                              </span>
                              <span className="text-[11px] text-[#6B655F] truncate">
                                {qa.hint}
                              </span>
                            </span>
                            <ChevronRight className="ml-auto h-4 w-4 text-[#3F3A35] group-hover:text-amber-400/70 transition-colors" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {recents.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6B655F] px-1">
                        Recent
                      </div>
                      <div className="flex flex-col">
                        {recents.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setQuery(r)}
                            className="flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors hover:bg-white/[0.04] group"
                          >
                            <Clock className="h-4 w-4 text-[#6B655F]" />
                            <span className="flex-1 truncate text-[13.5px] text-[#F5F1EA]">{r}</span>
                            <ChevronRight className="h-4 w-4 text-[#3F3A35] group-hover:text-amber-400/70 group-hover:translate-x-0.5 transition-all" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6B655F] px-1">
                      Try
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => setQuery(ex)}
                          className="rounded-full px-3 py-1.5 text-[12.5px] text-[#F5F1EA] bg-white/[0.04] border border-white/[0.06] hover:border-amber-500/40 hover:bg-amber-500/[0.08] transition-colors"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {!loading && hasQuery && results.length === 0 && (
                <div className="py-16 text-center text-sm text-[#A8A29E] flex flex-col items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/[0.06]">
                    <Search className="h-5 w-5 text-[#6B655F]" />
                  </div>
                  <div>
                    No results for <span className="font-medium text-[#F5F1EA]">&quot;{query}&quot;</span>
                  </div>
                  <div className="text-[12px] text-[#6B655F]">Try a project number, name, address, or sub.</div>
                </div>
              )}

              {!loading &&
                GROUP_ORDER.map((g) => {
                  const items = grouped[g];
                  if (!items || items.length === 0) return null;
                  const Icon = GROUP_ICONS[g];
                  const tint = GROUP_TINT[g];
                  return (
                    <CommandGroup key={g} heading={GROUP_LABELS[g]}>
                      {items.map((r) => (
                        <CommandItem
                          key={`${r.group}-${r.id}`}
                          value={`${r.group}-${r.id}`}
                          onSelect={() => handleSelect(r.href)}
                          className="group flex items-center gap-3 px-3 py-3 text-[#F5F1EA]"
                        >
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                            style={{ background: tint.bg, color: tint.fg }}
                          >
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
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
                          </span>
                          <ChevronRight className="h-4 w-4 text-[#3F3A35] group-data-[selected=true]:text-amber-400 transition-colors" />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}
            </CommandList>

            {/* Footer hints — desktop only */}
            <div className="hidden sm:flex items-center justify-between gap-4 border-t border-white/[0.06] px-4 py-2.5 text-[10px] text-[#6B655F]">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 py-px text-[10px]">↑</kbd>
                  <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 py-px text-[10px]">↓</kbd>
                  navigate
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 py-px text-[10px]"><CornerDownLeft className="inline h-2.5 w-2.5" /></kbd>
                  open
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 py-px text-[10px]">esc</kbd>
                  close
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-amber-400" />
                Smart search
              </span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

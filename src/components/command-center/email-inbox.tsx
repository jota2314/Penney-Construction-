"use client";

import { useState, useMemo, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Paperclip,
  CheckCircle,
  Mail,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  HardHat,
  Users,
  Building2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { reconnectGoogle } from "@/lib/auth/actions";
import { formatDate } from "@/lib/utils";

interface StoredEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  to_name: string;
  to_email: string;
  date: string;
  direction: string;
  snippet: string;
  is_processed: boolean;
  is_dismissed: boolean;
  project_id: string | null;
  attachments: { filename: string; mimeType: string; storage_path: string | null }[];
}

type FilterTab = "new" | "processed" | "dismissed";
type Category = "all" | "subs" | "clients" | "internal";

const TABS: { key: FilterTab; label: string }[] = [
  { key: "new", label: "New" },
  { key: "processed", label: "Processed" },
  { key: "dismissed", label: "Not Interested" },
];

const TEAM_DOMAIN = "penneyconstructioninc.com";

const PAGE_SIZE = 100;

interface EmailInboxProps {
  initialEmails: StoredEmail[];
  totalCount: number;
  unprocessedCount: number;
  subEmails?: string[];
  customerEmails?: string[];
}

export function EmailInbox({ initialEmails, totalCount, unprocessedCount, subEmails = [], customerEmails = [] }: EmailInboxProps) {
  const [emails, setEmails] = useState<StoredEmail[]>(initialEmails);
  const [activeTab, setActiveTab] = useState<FilterTab>("new");
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Categorize an email
  function getCategory(e: StoredEmail): Category {
    const fromLower = e.from_email.toLowerCase();
    const toLower = e.to_email.toLowerCase();
    // Internal = both sides are penney
    if (fromLower.endsWith(TEAM_DOMAIN) && toLower.endsWith(TEAM_DOMAIN)) return "internal";
    // Sub = either from or to a known sub
    if (subEmails.includes(fromLower) || subEmails.includes(toLower)) return "subs";
    // Client = either from or to a known customer
    if (customerEmails.includes(fromLower) || customerEmails.includes(toLower)) return "clients";
    return "all";
  }

  // Filter emails by tab + category + search
  const filteredEmails = useMemo(() => {
    let filtered: StoredEmail[];
    switch (activeTab) {
      case "new":
        filtered = emails.filter(e => !e.is_processed && !e.is_dismissed);
        break;
      case "processed":
        filtered = emails.filter(e => e.is_processed && !e.is_dismissed);
        break;
      case "dismissed":
        filtered = emails.filter(e => e.is_dismissed);
        break;
    }

    // Category filter
    if (category !== "all") {
      filtered = filtered.filter(e => getCategory(e) === category);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(e =>
        e.subject?.toLowerCase().includes(q) ||
        e.from_name?.toLowerCase().includes(q) ||
        e.from_email?.toLowerCase().includes(q) ||
        e.to_name?.toLowerCase().includes(q) ||
        e.to_email?.toLowerCase().includes(q) ||
        e.snippet?.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [emails, activeTab, category, search, subEmails, customerEmails]);

  // Counts for tab badges
  const counts = useMemo(() => ({
    new: emails.filter(e => !e.is_processed && !e.is_dismissed).length,
    processed: emails.filter(e => e.is_processed && !e.is_dismissed).length,
    dismissed: emails.filter(e => e.is_dismissed).length,
  }), [emails]);

  // Category counts (within current tab)
  const categoryCounts = useMemo(() => {
    let tabEmails: StoredEmail[];
    switch (activeTab) {
      case "new": tabEmails = emails.filter(e => !e.is_processed && !e.is_dismissed); break;
      case "processed": tabEmails = emails.filter(e => e.is_processed && !e.is_dismissed); break;
      case "dismissed": tabEmails = emails.filter(e => e.is_dismissed); break;
    }
    return {
      all: tabEmails.length,
      subs: tabEmails.filter(e => getCategory(e) === "subs").length,
      clients: tabEmails.filter(e => getCategory(e) === "clients").length,
      internal: tabEmails.filter(e => getCategory(e) === "internal").length,
    };
  }, [emails, activeTab, subEmails, customerEmails]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredEmails.length / PAGE_SIZE));
  const paginatedEmails = filteredEmails.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when switching tabs or category
  function handleTabChange(tab: FilterTab) {
    setActiveTab(tab);
    setPage(1);
  }

  function handleCategoryChange(cat: Category) {
    setCategory(cat);
    setPage(1);
  }

  async function handleFetchMore() {
    setFetching(true);
    setResult(null);
    setNeedsReconnect(false);
    try {
      const res = await fetch("/api/fetch-and-store-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await res.json();
      if (data.error) {
        if (data.error.includes("OAuth") || data.error.includes("token")) {
          setNeedsReconnect(true);
          return;
        }
        throw new Error(data.error);
      }
      setResult(data.message);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      if (msg.includes("OAuth") || msg.includes("token")) {
        setNeedsReconnect(true);
      } else {
        setResult(msg);
      }
    } finally {
      setFetching(false);
    }
  }

  function handleDismiss(e: React.MouseEvent, emailId: string) {
    e.stopPropagation();
    startTransition(async () => {
      const res = await fetch("/api/fetch-and-store-emails", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId, is_dismissed: true }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(em =>
          em.id === emailId ? { ...em, is_dismissed: true } : em
        ));
      }
    });
  }

  function handleRestore(e: React.MouseEvent, emailId: string) {
    e.stopPropagation();
    startTransition(async () => {
      const res = await fetch("/api/fetch-and-store-emails", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId, is_dismissed: false }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(em =>
          em.id === emailId ? { ...em, is_dismissed: false } : em
        ));
      }
    });
  }

  function handleEmailClick(email: StoredEmail) {
    router.push(`/command-center/email/${email.id}`);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-lg font-semibold shrink-0">Inbox</h2>
          <Badge variant="secondary" className="text-xs shrink-0">{totalCount}</Badge>
          {result && !needsReconnect && <p className="text-[10px] text-muted-foreground truncate">{result}</p>}
        </div>
        <Button onClick={handleFetchMore} disabled={fetching} variant="outline" size="sm" className="shrink-0">
          {fetching ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
          {fetching ? "..." : "Fetch"}
        </Button>
      </div>

      {/* Google reconnect banner */}
      {needsReconnect && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <RefreshCw className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-200 flex-1">Google session expired</p>
          <form action={reconnectGoogle}>
            <Button type="submit" size="sm" className="bg-amber-600 hover:bg-amber-700 text-white text-xs">
              Reconnect Google
            </Button>
          </form>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-amber-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {counts[tab.key] > 0 && (
              <Badge
                variant="secondary"
                className={`ml-1.5 text-[9px] h-4 px-1 ${
                  tab.key === "new" && counts.new > 0 ? "bg-amber-500/20 text-amber-400" : ""
                }`}
              >
                {counts[tab.key]}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Search + Category filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search emails..."
            className="pl-8 h-9 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {([
            { key: "all" as Category, label: "All", icon: Mail, count: categoryCounts.all },
            { key: "subs" as Category, label: "Subs", icon: HardHat, count: categoryCounts.subs },
            { key: "clients" as Category, label: "Clients", icon: Users, count: categoryCounts.clients },
            { key: "internal" as Category, label: "Internal", icon: Building2, count: categoryCounts.internal },
          ]).map((cat) => (
            <button
              key={cat.key}
              onClick={() => handleCategoryChange(cat.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                category === cat.key
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "bg-muted text-muted-foreground hover:text-foreground border border-transparent"
              }`}
            >
              <cat.icon className="h-3 w-3" />
              {cat.label}
              {cat.count > 0 && <span className="text-[9px] opacity-70">{cat.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Email list */}
      {paginatedEmails.length > 0 ? (
        <>
          <div className="border rounded-lg divide-y overflow-hidden">
            {paginatedEmails.map((email) => (
              <div
                key={email.id}
                className="flex items-start hover:bg-muted/50 transition-colors"
              >
                <button
                  onClick={() => handleEmailClick(email)}
                  className="flex-1 text-left px-4 py-3 flex items-start gap-3 min-w-0"
                >
                  {/* Direction */}
                  <div className={`p-1.5 rounded shrink-0 mt-0.5 ${
                    email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"
                  }`}>
                    {email.direction === "inbound"
                      ? <ArrowDownLeft className="h-3.5 w-3.5 text-blue-400" />
                      : <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm truncate ${!email.is_processed && !email.is_dismissed ? "font-medium" : ""}`}>
                        {email.subject || "(no subject)"}
                      </p>
                      {email.is_processed && (
                        <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {email.direction === "inbound"
                        ? email.from_name || email.from_email
                        : `To: ${email.to_name || email.to_email}`}
                    </p>
                    <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                      {email.snippet}
                    </p>
                  </div>

                  {/* Right side */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground">
                      {formatDate(email.date)}
                    </span>
                    <div className="flex gap-1">
                      {email.attachments && email.attachments.length > 0 && (
                        <Badge variant="outline" className="text-[9px] gap-0.5 px-1">
                          <Paperclip className="h-2.5 w-2.5" />
                          {email.attachments.length}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>

                {/* Dismiss / Restore button */}
                <div className="pr-2 pt-3 shrink-0">
                  {activeTab === "dismissed" ? (
                    <button
                      onClick={(e) => handleRestore(e, email.id)}
                      disabled={isPending}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Restore email"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => handleDismiss(e, email.id)}
                      disabled={isPending}
                      className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors"
                      title="Not interested"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredEmails.length)} of {filteredEmails.length}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs flex items-center px-2 text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
          {activeTab === "new" && <p>No new emails</p>}
          {activeTab === "processed" && <p>No processed emails yet</p>}
          {activeTab === "dismissed" && <p>No dismissed emails</p>}
          {activeTab === "new" && <p className="text-sm mt-1">Click &quot;Fetch&quot; to pull from Gmail</p>}
        </div>
      )}
    </div>
  );
}

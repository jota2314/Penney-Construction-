"use client";

/**
 * Drafts view for the email inbox — the "Drafts" toggle in the filter bar.
 *
 * Emails composed but not sent live in `email_drafts` with status="draft":
 * overnight auto-triage replies, MCP-composed drafts from chat, and anything
 * parked mid-edit. Until this view existed they were only reachable by knowing
 * the row's UUID, so hundreds piled up unseen.
 *
 * Rows link to `/email-draft/[id]`, the review screen that already handles
 * editing, sending and discarding. Nothing here sends.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X, Sparkles, PenLine, Paperclip, ChevronRight, Inbox } from "lucide-react";

export interface DraftRow {
  id: string;
  to: string[];
  subject: string;
  bodyPreview: string;
  projectName: string | null;
  origin: string | null;
  createdBy: string;
  createdAt: string;
  attachmentCount: number;
}

/** auto_triage drafts are written by the overnight daemon, not by a person. */
function isAutoDrafted(d: DraftRow): boolean {
  return d.origin === "auto_triage" || d.createdBy === "auto_triage";
}

function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

/** Stale drafts are almost always superseded edits — worth showing dimmer. */
function isStale(iso: string): boolean {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then > 7 * 24 * 60 * 60 * 1000;
}

export function DraftsList({ drafts }: { drafts: DraftRow[] }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter(
      (d) =>
        d.subject.toLowerCase().includes(q) ||
        d.to.some((t) => t.toLowerCase().includes(q)) ||
        (d.projectName ?? "").toLowerCase().includes(q) ||
        d.bodyPreview.toLowerCase().includes(q),
    );
  }, [drafts, search]);

  const aiCount = useMemo(() => drafts.filter(isAutoDrafted).length, [drafts]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search drafts…"
            className="w-full pl-8 pr-8 h-8 text-sm rounded-md bg-muted/40 border border-border/50 focus:outline-none focus:border-amber-500/50 focus:bg-background"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {aiCount > 0 && !search && (
          <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-amber-500" />
            {aiCount} drafted for you overnight
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-24 md:pb-0">
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center p-8 text-center">
            <div>
              <div className="h-12 w-12 mx-auto rounded-full bg-muted/40 flex items-center justify-center mb-3">
                <Inbox className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">
                {search ? "No drafts match" : "No drafts waiting"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {search
                  ? "Try a different search."
                  : "Drafts written by the AI or parked from chat show up here."}
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {visible.map((d) => {
              const ai = isAutoDrafted(d);
              const stale = isStale(d.createdAt);
              return (
                <li key={d.id}>
                  <Link
                    href={`/email-draft/${d.id}`}
                    className={`flex items-start gap-3 px-3 py-3 hover:bg-muted/40 transition-colors ${
                      stale ? "opacity-60" : ""
                    }`}
                  >
                    <div
                      className={`mt-0.5 h-7 w-7 shrink-0 rounded-full flex items-center justify-center border ${
                        ai
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                          : "bg-muted/50 border-border/60 text-muted-foreground"
                      }`}
                    >
                      {ai ? <Sparkles className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium truncate">
                          {d.to.length > 0 ? d.to.join(", ") : "No recipient"}
                        </span>
                        {/* Relative to render time, so the server HTML and the
                            client hydration can disagree across a boundary. */}
                        <span
                          suppressHydrationWarning
                          className="ml-auto text-[11px] text-muted-foreground tabular-nums shrink-0"
                        >
                          {relativeAge(d.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm truncate">{d.subject || "(no subject)"}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {d.bodyPreview}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {d.projectName && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground truncate max-w-[160px]">
                            {d.projectName}
                          </span>
                        )}
                        {ai && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            AI draft
                          </span>
                        )}
                        {d.attachmentCount > 0 && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Paperclip className="h-3 w-3" />
                            {d.attachmentCount}
                          </span>
                        )}
                        {stale && (
                          <span className="text-[10px] text-muted-foreground">older</span>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

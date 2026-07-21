import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { canReviewEstimates } from "@/lib/auth/role-access";
import { Clock, FileCheck, CheckCircle2, AlertCircle } from "lucide-react";

export const metadata: Metadata = { title: "Reviews | Penney Construction" };

interface ReviewEstimate {
  id: string;
  name: string | null;
  total_price: number | string | null;
  approval_status: string;
  submitted_for_review_at: string | null;
  reviewed_at: string | null;
  approval_notes: string | null;
  project_id: string | null;
  project?: { name: string; project_number: string | null } | null;
}

function fmtMoney(v: number | string | null | undefined): string {
  if (v == null) return "$0";
  const n = typeof v === "number" ? v : Number(v) || 0;
  return "$" + n.toLocaleString();
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export default async function ReviewsIndexPage() {
  const user = await requireAuth();
  if (!canReviewEstimates(user.profile?.role)) redirect("/command-center");
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("estimates")
    .select(`
      id, name, total_price, approval_status,
      submitted_for_review_at, reviewed_at, approval_notes,
      project_id,
      project:projects!estimates_project_id_fkey(name, project_number)
    `)
    .in("approval_status", ["pending_review", "approved", "changes_requested"])
    .order("submitted_for_review_at", { ascending: false })
    .limit(50);

  const normalized = (rows || []).map((r: unknown) => {
    const row = r as ReviewEstimate & { project: unknown };
    const project = Array.isArray(row.project) ? row.project[0] : row.project;
    return { ...row, project: project as ReviewEstimate["project"] };
  });

  const pending = normalized.filter(r => r.approval_status === "pending_review");
  const decided = normalized.filter(r => r.approval_status !== "pending_review");

  return (
    <div className="flex flex-1 flex-col min-w-0 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-6 sm:px-8 sm:py-7">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Proposal reviews
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {pending.length > 0
              ? <>You have <span className="text-amber-600 dark:text-amber-500">{pending.length}</span> to review</>
              : "Caught up — nothing to review"}
          </h1>
        </div>

        {pending.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Pending your review
            </h2>
            <ul className="flex flex-col gap-2 list-none p-0 m-0">
              {pending.map(r => (
                <li key={r.id}>
                  <Link
                    href={`/command-center/reviews/${r.id}`}
                    className="block bg-card border border-amber-500/40 rounded-xl p-4 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                          <span className="text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold">
                            Pending
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            · submitted {relTime(r.submitted_for_review_at)}
                          </span>
                        </div>
                        <div className="text-[15px] font-semibold truncate">
                          {r.project?.name || r.name || "Untitled estimate"}
                          {r.project?.project_number && (
                            <span className="font-mono text-[11px] text-muted-foreground ml-2">
                              {r.project.project_number}
                            </span>
                          )}
                        </div>
                        {r.name && r.project?.name && r.name !== r.project.name && (
                          <div className="text-[12px] text-muted-foreground mt-0.5">{r.name}</div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[18px] font-bold tabular-nums">{fmtMoney(r.total_price)}</div>
                        <div className="text-[11px] text-muted-foreground">client price</div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {decided.length > 0 && (
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Recently decided
            </h2>
            <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
              {decided.slice(0, 20).map(r => {
                const approved = r.approval_status === "approved";
                return (
                  <li key={r.id}>
                    <Link
                      href={`/command-center/reviews/${r.id}`}
                      className="block bg-card border border-border rounded-lg px-4 py-3 hover:border-amber-500/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {approved ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold truncate">
                              {r.project?.name || r.name || "Untitled"}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {approved ? "Approved" : "Changes requested"} · {relTime(r.reviewed_at)}
                            </div>
                          </div>
                        </div>
                        <div className="font-mono text-[12px] text-muted-foreground tabular-nums shrink-0">
                          {fmtMoney(r.total_price)}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {pending.length === 0 && decided.length === 0 && (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <FileCheck className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Nothing submitted for review yet. When Jorge sends a proposal, it&apos;ll land here.
            </p>
          </div>
        )}

        <Clock className="hidden" />
      </div>
    </div>
  );
}

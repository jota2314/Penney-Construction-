import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { FileText, Hammer } from "lucide-react";

export const metadata: Metadata = { title: "Scope of Work | Penney Construction" };

interface TradeEntry {
  trade: string;
  status: string;
  preferred_subs?: string[];
}

export default async function ScopePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, scope_of_work, required_trades, project_type, description")
    .eq("id", id)
    .single();

  if (!project) notFound();

  const scopeOfWork = (project as Record<string, unknown>).scope_of_work as string | null;
  const requiredTrades = (project as Record<string, unknown>).required_trades as TradeEntry[] | null;

  const STATUS_COLORS: Record<string, string> = {
    needed: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    quoted: "bg-blue-500/15 text-blue-500 border-blue-500/30",
    booked: "bg-green-500/15 text-green-500 border-green-500/30",
    complete: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  };

  return (
    <>
      <Header title={`Scope — ${project.name}`} backHref={`/projects/${id}/estimates`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        {/* Scope of Work */}
        <div className="rounded-xl border bg-card p-4 sm:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-orange-500/15 flex items-center justify-center">
              <FileText className="h-5 w-5 text-orange-500" />
            </div>
            <h2 className="text-lg font-semibold">Scope of Work</h2>
          </div>

          {scopeOfWork ? (
            <div className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
              {scopeOfWork}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/60 italic">
              No scope of work defined yet. The AI will populate this from email triage and project details.
            </p>
          )}

          {project.description && project.description !== scopeOfWork && (
            <div className="pt-2 border-t">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Project Description</p>
              <p className="text-sm text-muted-foreground/80">{project.description}</p>
            </div>
          )}
        </div>

        {/* Required Trades */}
        <div className="rounded-xl border bg-card p-4 sm:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-purple-500/15 flex items-center justify-center">
              <Hammer className="h-5 w-5 text-purple-500" />
            </div>
            <h2 className="text-lg font-semibold">Required Trades</h2>
            {requiredTrades && requiredTrades.length > 0 && (
              <Badge variant="secondary" className="text-xs ml-auto">
                {requiredTrades.length} {requiredTrades.length === 1 ? "trade" : "trades"}
              </Badge>
            )}
          </div>

          {requiredTrades && requiredTrades.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {requiredTrades.map((t, idx) => (
                <div key={idx} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium capitalize">{t.trade}</p>
                    {t.preferred_subs && t.preferred_subs.length > 0 && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        Preferred: {t.preferred_subs.join(", ")}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[9px] shrink-0 ${STATUS_COLORS[t.status] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {t.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/60 italic">
              No trades identified yet. The AI will extract required trades from quotes and project scope.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

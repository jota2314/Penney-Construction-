"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Send, Clock, CheckCircle2, AlertCircle, Users } from "lucide-react";
import { CreateBidDialog } from "./create-bid-dialog";
import { cn } from "@/lib/utils";

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Send }> = {
  draft: { label: "Draft", color: "bg-muted text-muted-foreground", icon: Clock },
  sent: { label: "Sent", color: "bg-blue-500/20 text-blue-400", icon: Send },
  receiving: { label: "Receiving Bids", color: "bg-amber-500/20 text-amber-400", icon: AlertCircle },
  awarded: { label: "Awarded", color: "bg-green-500/20 text-green-400", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "bg-red-500/20 text-red-400", icon: AlertCircle },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function BidDashboard({ packages }: { packages: any[] }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  // Group by project
  const byProject = new Map<string, { project: { name: string; project_number: string }; packages: typeof packages }>();
  for (const pkg of packages) {
    const key = pkg.project_id;
    if (!byProject.has(key)) {
      byProject.set(key, { project: pkg.projects || { name: pkg.name, project_number: "" }, packages: [] });
    }
    byProject.get(key)!.packages.push(pkg);
  }

  // Stats
  const totalActive = packages.filter((p) => ["sent", "receiving"].includes(p.status)).length;
  const totalAwaiting = packages.reduce((sum, p) =>
    sum + (p.subcontractor_bids?.filter((b: { status: string }) => b.status === "invited").length ?? 0), 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Bids</h2>
          <p className="text-muted-foreground text-sm">
            {totalActive} active packages, {totalAwaiting} subs awaiting response
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="min-h-[44px]">
          <Plus className="mr-2 h-4 w-4" />
          New Bid Package
        </Button>
      </div>

      {packages.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">No bid packages yet</p>
          <p className="text-sm mt-1">Create a bid package to send RFQs to your subs</p>
          <Button onClick={() => setCreateOpen(true)} className="mt-4">
            <Plus className="mr-2 h-4 w-4" /> Create First Bid Package
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(byProject.entries()).map(([projectId, { project, packages: pkgs }]) => (
            <div key={projectId}>
              <Link
                href={`/projects/${projectId}/bids`}
                className="text-sm font-semibold text-muted-foreground mb-2 hover:text-foreground inline-flex items-center gap-1"
              >
                {project.project_number ? `${project.project_number} — ` : ""}{project.name}
                <span className="text-amber-400">→ open project bids</span>
              </Link>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pkgs.map((pkg) => {
                  const config = STATUS_CONFIG[pkg.status] || STATUS_CONFIG.draft;
                  const Icon = config.icon;
                  const bids = pkg.subcontractor_bids || [];
                  const invited = bids.filter((b: { status: string }) => b.status === "invited").length;
                  const submitted = bids.filter((b: { status: string }) => b.status === "submitted").length;
                  const selected = bids.find((b: { is_selected: boolean }) => b.is_selected);
                  const lowestBid = bids
                    .filter((b: { amount: number | null; status: string }) => b.amount && b.status === "submitted")
                    .sort((a: { amount: number }, b: { amount: number }) => a.amount - b.amount)[0];

                  return (
                    <Link
                      key={pkg.id}
                      href={`/projects/${projectId}/bids`}
                      className="block rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{pkg.trade}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">{pkg.name}</div>
                        </div>
                        <Badge className={cn("text-[10px] shrink-0", config.color)}>
                          <Icon className="h-3 w-3 mr-1" />
                          {config.label}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span>{bids.length} subs</span>
                        {invited > 0 && <span className="text-amber-400">{invited} awaiting</span>}
                        {submitted > 0 && <span className="text-blue-400">{submitted} received</span>}
                      </div>

                      {lowestBid && !selected && (
                        <div className="mt-2 text-sm">
                          Low bid: <span className="font-semibold text-green-400">{fmt(lowestBid.amount)}</span>
                          <span className="text-xs text-muted-foreground ml-1">
                            ({lowestBid.subcontractors?.company_name})
                          </span>
                        </div>
                      )}

                      {selected && (
                        <div className="mt-2 text-sm">
                          Awarded: <span className="font-semibold text-green-400">{fmt(selected.amount)}</span>
                          <span className="text-xs text-muted-foreground ml-1">
                            ({selected.subcontractors?.company_name})
                          </span>
                        </div>
                      )}

                      {pkg.due_date && (
                        <div className="text-[11px] text-muted-foreground mt-2">
                          Due: {new Date(pkg.due_date).toLocaleDateString()}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateBidDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

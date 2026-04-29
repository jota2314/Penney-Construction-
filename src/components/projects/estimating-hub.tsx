"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { NavigationTile } from "@/components/command-center/navigation-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Ruler,
  FileSpreadsheet,
  DollarSign,
  FileText,
  Calculator,
  Users,
  Loader2,
  CheckCircle,
  Mail,
  AlertTriangle,
  Gavel,
  ChevronDown,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { createEstimate, bulkCreateLineItems } from "@/lib/actions/estimates";
import type { Project, Estimate, QuoteRequest } from "@/types/database";

interface EstimatingHubProps {
  project: Project;
  estimates: Estimate[];
  quotes: QuoteRequest[];
  drawingsCount: number;
  pricingFilesCount: number;
  bidPackageCount?: number;
  bidsAwaitingCount?: number;
}

interface TakeoffLineItem {
  description: string;
  trade: string | null;
  quantity: number;
  unit: string;
  unit_cost: number;
  total_price: number;
  needs_sub_quote: boolean;
  proposal_description: string;
  source: "takeoff";
}

export function EstimatingHub({
  project,
  estimates,
  quotes,
  drawingsCount,
  pricingFilesCount,
  bidPackageCount = 0,
  bidsAwaitingCount = 0,
}: EstimatingHubProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromTakeoff = searchParams.get("from") === "takeoff";

  const [takeoffItems, setTakeoffItems] = useState<TakeoffLineItem[] | null>(null);
  const [takeoffSource, setTakeoffSource] = useState<string | null>(null);
  const [importingEstimate, setImportingEstimate] = useState(false);
  const [importDone, setImportDone] = useState(false);

  const latestEstimate = estimates.length > 0 ? estimates[0] : null;
  const totalQuoted = quotes.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);

  // Load takeoff line items from sessionStorage
  useEffect(() => {
    if (!fromTakeoff) return;
    try {
      const raw = sessionStorage.getItem("takeoff-line-items");
      const src = sessionStorage.getItem("takeoff-source");
      if (raw) {
        setTakeoffItems(JSON.parse(raw));
        setTakeoffSource(src);
      }
    } catch { /* ignore */ }
  }, [fromTakeoff]);

  async function handleImportToEstimate() {
    if (!takeoffItems || takeoffItems.length === 0) return;
    setImportingEstimate(true);
    try {
      // Create a new estimate
      const estimate = await createEstimate({
        name: `Takeoff Estimate${takeoffSource ? ` — ${takeoffSource}` : ""}`,
        projectId: project.id,
      });
      if (!estimate || estimate.error || !estimate.id) throw new Error(estimate?.error || "Failed to create estimate");

      // Convert takeoff items to line items format
      const lineItems = takeoffItems.map(item => ({
        description: item.description,
        proposal_description: item.proposal_description || "",
        total_price: item.total_price,
        quantity: item.quantity,
        unit: item.unit,
        unit_cost: item.unit_cost,
        trade: item.trade,
        needs_sub_quote: item.needs_sub_quote,
        source: "takeoff" as const,
      }));

      await bulkCreateLineItems(estimate.id!, lineItems, "replace");

      // Clear sessionStorage
      sessionStorage.removeItem("takeoff-line-items");
      sessionStorage.removeItem("takeoff-source");

      setImportDone(true);
      // Navigate to the new estimate
      setTimeout(() => {
        router.push(`/projects/${project.id}/estimates/${estimate.id!}`);
      }, 500);
    } catch (err) {
      console.error("Import failed:", err);
    } finally {
      setImportingEstimate(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Takeoff Import Banner */}
      {takeoffItems && takeoffItems.length > 0 && !importDone && (
        <div className="rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-500/15 shrink-0">
              <FileSpreadsheet className="h-5 w-5 text-blue-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold">Estimate Ready from Takeoff</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {takeoffItems.length} line items generated from {takeoffSource || "drawing takeoff"}
              </p>
            </div>
          </div>

          {/* Preview of items */}
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {takeoffItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-background/50 rounded px-3 py-1.5">
                <span className="flex-1 truncate">{item.description}</span>
                {item.trade && <Badge variant="secondary" className="text-[9px] shrink-0">{item.trade}</Badge>}
                {item.needs_sub_quote && (
                  <Badge className="text-[9px] bg-amber-500/15 text-amber-500 border-amber-500/30 shrink-0 gap-0.5">
                    <Mail className="h-2.5 w-2.5" /> Need Quote
                  </Badge>
                )}
                <span className="font-medium text-green-500 shrink-0">{formatCurrency(item.total_price)}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              size="sm"
              onClick={handleImportToEstimate}
              disabled={importingEstimate}
            >
              {importingEstimate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              {importingEstimate ? "Creating Estimate..." : "Create Estimate with These Items"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{formatCurrency(takeoffItems.reduce((s, i) => s + i.total_price, 0))}</span>
              {" · "}{takeoffItems.filter(i => i.needs_sub_quote).length} need sub quotes
            </span>
          </div>
        </div>
      )}

      {/* Project context */}
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-bold">{project.name}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {[
              project.project_number,
              project.project_type?.replace(/_/g, " "),
              project.address,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        {project.scope_of_work && (
          <ScopeOfWorkCard scope={project.scope_of_work} />
        )}
      </div>

      {/* Tiles */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <NavigationTile
          title="Project Drawings"
          icon={Ruler}
          iconColorClass="bg-blue-500/15 text-blue-500"
          metric={drawingsCount}
          metricLabel={drawingsCount === 1 ? "Drawing" : "Drawings"}
          metricColorClass="text-blue-600 dark:text-blue-400"
          href={`/projects/${project.id}/estimates/drawings`}
        >
          <span className="text-xs text-muted-foreground">
            Plans, blueprints, construction docs
          </span>
        </NavigationTile>

        <NavigationTile
          title="Prepare Proposal"
          icon={FileSpreadsheet}
          iconColorClass="bg-amber-500/15 text-amber-600"
          metric={estimates.length}
          metricLabel={estimates.length === 1 ? "Estimate" : "Estimates"}
          metricColorClass="text-amber-600 dark:text-amber-400"
          href={
            latestEstimate
              ? `/projects/${project.id}/estimates/${latestEstimate.id}`
              : `/projects/${project.id}/estimates/new`
          }
        >
          {latestEstimate ? (
            <span className="text-xs text-muted-foreground">
              Latest: {formatCurrency(latestEstimate.total_price)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Create initial proposal
            </span>
          )}
        </NavigationTile>

        <NavigationTile
          title="Pricing & Specs"
          icon={DollarSign}
          iconColorClass="bg-green-500/15 text-green-500"
          metric={pricingFilesCount}
          metricLabel={pricingFilesCount === 1 ? "File" : "Files"}
          metricColorClass="text-green-600 dark:text-green-400"
          href={`/projects/${project.id}/estimates/pricing`}
        >
          <span className="text-xs text-muted-foreground">
            Pricing guidelines, specs, rates
          </span>
        </NavigationTile>

        <NavigationTile
          title="Bids & Quotes"
          icon={Gavel}
          iconColorClass="bg-purple-500/15 text-purple-500"
          metric={quotes.length + bidPackageCount}
          metricLabel={quotes.length + bidPackageCount === 1 ? "Item" : "Items"}
          metricColorClass="text-purple-600 dark:text-purple-400"
          href={`/projects/${project.id}/bids`}
          urgencyBadge={bidsAwaitingCount > 0 ? { label: `${bidsAwaitingCount} awaiting`, variant: "default" as const } : undefined}
        >
          <span className="text-xs text-muted-foreground">
            {totalQuoted > 0 ? `${formatCurrency(totalQuoted)} quoted` : "Send bids, track quotes, award"}
            {bidPackageCount > 0 ? ` · ${bidPackageCount} bid pkg` : ""}
          </span>
        </NavigationTile>

        <NavigationTile
          title="Cost Book"
          icon={Calculator}
          iconColorClass="bg-teal-500/15 text-teal-500"
          metric="—"
          metricLabel="Rates"
          metricColorClass="text-teal-600 dark:text-teal-400"
          href="/estimates?tab=costbook"
        >
          <span className="text-xs text-muted-foreground">
            Trade rates & unit costs
          </span>
        </NavigationTile>

        <NavigationTile
          title="Scope of Work"
          icon={FileText}
          iconColorClass="bg-orange-500/15 text-orange-500"
          metric={project.scope_of_work ? "1" : "—"}
          metricLabel="Scope"
          metricColorClass="text-orange-600 dark:text-orange-400"
          href={`/projects/${project.id}/estimates/scope`}
        >
          <span className="text-xs text-muted-foreground">
            Define & refine project scope
          </span>
        </NavigationTile>
      </div>

      {/* Quick stats bar */}
      {(latestEstimate || totalQuoted > 0 || project.estimated_value) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {project.estimated_value && (
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Est. Value</div>
              <div className="text-lg font-bold mt-0.5">{formatCurrency(project.estimated_value)}</div>
            </div>
          )}
          {project.contract_value && (
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Contract</div>
              <div className="text-lg font-bold text-green-500 mt-0.5">{formatCurrency(project.contract_value)}</div>
            </div>
          )}
          {latestEstimate && (
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Latest Estimate</div>
              <div className="text-lg font-bold text-amber-500 mt-0.5">{formatCurrency(latestEstimate.total_price)}</div>
              <div className="text-[10px] text-muted-foreground">v{latestEstimate.version} &middot; {latestEstimate.status}</div>
            </div>
          )}
          {totalQuoted > 0 && (
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Quoted</div>
              <div className="text-lg font-bold text-purple-500 mt-0.5">{formatCurrency(totalQuoted)}</div>
              <div className="text-[10px] text-muted-foreground">{quotes.length} sub quotes</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Collapsible scope-of-work card — Jorge's scope text can be 5k+ chars on
// bigger projects. Default collapsed to a preview; click to expand.
function ScopeOfWorkCard({ scope }: { scope: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = scope.trim();
  const preview = trimmed.length > 180 ? trimmed.slice(0, 180).replace(/\s+\S*$/, "") + "…" : trimmed;
  const isLong = trimmed.length > 180;

  return (
    <div className="rounded-xl border bg-card max-w-3xl">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardList className="h-4 w-4 text-amber-500" />
          <span>Scope of Work</span>
          <span className="text-[10px] text-muted-foreground font-normal">
            {trimmed.length.toLocaleString()} chars
          </span>
        </div>
        {isLong && (
          expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <div className="px-4 pb-3">
        {expanded || !isLong ? (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-[60vh] overflow-y-auto pr-2">
            {trimmed}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground/80 line-clamp-2">
            {preview}
          </div>
        )}
      </div>
    </div>
  );
}

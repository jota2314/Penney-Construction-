"use client";

import { NavigationTile } from "@/components/command-center/navigation-tile";
import { Badge } from "@/components/ui/badge";
import {
  Ruler,
  FileSpreadsheet,
  DollarSign,
  FileText,
  Calculator,
  Users,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Project, Estimate, QuoteRequest } from "@/types/database";

interface EstimatingHubProps {
  project: Project;
  estimates: Estimate[];
  quotes: QuoteRequest[];
  drawingsCount: number;
  pricingFilesCount: number;
}

export function EstimatingHub({
  project,
  estimates,
  quotes,
  drawingsCount,
  pricingFilesCount,
}: EstimatingHubProps) {
  const latestEstimate = estimates.length > 0 ? estimates[0] : null;
  const totalQuoted = quotes.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Project context */}
      <div>
        <h2 className="text-xl font-bold">{project.name}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {project.project_number} &middot; {project.project_type?.replace(/_/g, " ")}
          {project.address && ` &middot; ${project.address}`}
        </p>
        {project.scope_of_work && (
          <p className="text-sm text-muted-foreground/70 mt-2 max-w-2xl">
            {project.scope_of_work}
          </p>
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
          title="Sub Quotes"
          icon={Users}
          iconColorClass="bg-purple-500/15 text-purple-500"
          metric={quotes.length}
          metricLabel={quotes.length === 1 ? "Quote" : "Quotes"}
          metricColorClass="text-purple-600 dark:text-purple-400"
          href={`/projects/${project.id}/estimates/quotes`}
        >
          {totalQuoted > 0 ? (
            <span className="text-xs text-muted-foreground">
              {formatCurrency(totalQuoted)} total
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Request & track sub pricing
            </span>
          )}
        </NavigationTile>

        <NavigationTile
          title="Cost Book"
          icon={Calculator}
          iconColorClass="bg-teal-500/15 text-teal-500"
          metric="—"
          metricLabel="Rates"
          metricColorClass="text-teal-600 dark:text-teal-400"
          href="/cost-book"
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

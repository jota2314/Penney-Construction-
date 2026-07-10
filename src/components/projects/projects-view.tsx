"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LayoutGrid,
  List,
  Search,
  MapPin,
  User,
  DollarSign,
  HardHat,
  Trash2,
  Flame,
  FileText,
} from "lucide-react";
import { deleteProject } from "@/lib/actions/projects";

interface ProjectData {
  id: string;
  project_number: string;
  name: string;
  status: string;
  project_type: string;
  phase: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  description: string | null;
  estimated_value: number | null;
  contract_value: number | null;
  latest_estimate_total?: number | null;
  latest_estimate_id?: string | null;
  scope_of_work: string | null;
  customer: { first_name: string; last_name: string; email: string | null; phone: string | null } | null;
  progress?: number | null;
  updated_at: string;
  created_at: string;
  heatScore?: number;
}

interface ProjectsViewProps {
  projects: ProjectData[];
  customers: unknown[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  lead: { label: "Lead", color: "bg-zinc-500" },
  estimating: { label: "Estimating", color: "bg-amber-500" },
  waiting_for_approval: { label: "Waiting for Ryan", color: "bg-orange-500" },
  proposal_sent: { label: "Proposal", color: "bg-purple-500" },
  contracted: { label: "Contracted", color: "bg-blue-500" },
  in_progress: { label: "Active", color: "bg-green-500" },
  completed: { label: "Completed", color: "bg-emerald-700" },
  cancelled: { label: "Cancelled", color: "bg-red-500" },
};

const PHASE_LABELS: Record<string, string> = {
  preconstruction: "Pre-Con",
  pre_start: "Pre-Start",
  rough_in: "Rough-In",
  finishing: "Finishing",
  punch_list: "Punch List",
  complete: "Complete",
};

// Pipeline order for the Monday-style stage bar. Cancelled is handled
// separately (red bar) since it isn't a step on the journey.
const STAGE_PIPELINE = [
  { value: "lead", short: "Lead", color: "bg-zinc-400" },
  { value: "estimating", short: "Estimating", color: "bg-amber-500" },
  { value: "waiting_for_approval", short: "Ryan", color: "bg-orange-500" },
  { value: "proposal_sent", short: "Proposal", color: "bg-purple-500" },
  { value: "contracted", short: "Contract", color: "bg-blue-500" },
  { value: "in_progress", short: "Build", color: "bg-green-500" },
  { value: "completed", short: "Done", color: "bg-emerald-600" },
];

// Tailwind needs literal class names — ring color per current stage.
const RING_COLORS: Record<string, string> = {
  lead: "ring-zinc-400/50",
  estimating: "ring-amber-500/50",
  waiting_for_approval: "ring-orange-500/50",
  proposal_sent: "ring-purple-500/50",
  contracted: "ring-blue-500/50",
  in_progress: "ring-green-500/50",
  completed: "ring-emerald-600/50",
};

function StagePipeline({ project }: { project: ProjectData }) {
  const phase = project.phase ? PHASE_LABELS[project.phase] || project.phase : null;

  if (project.status === "cancelled") {
    return (
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-red-500/25 overflow-hidden">
          <div className="h-full w-full rounded-full bg-red-500/60" />
        </div>
        <div className="text-[11px] text-red-400 font-medium">Cancelled</div>
      </div>
    );
  }

  const currentIdx = STAGE_PIPELINE.findIndex((s) => s.value === project.status);
  const current = currentIdx >= 0 ? STAGE_PIPELINE[currentIdx] : null;

  return (
    <div className="space-y-1">
      <div className="flex gap-[3px]">
        {STAGE_PIPELINE.map((stage, i) => {
          const reached = currentIdx >= 0 && i <= currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <div
              key={stage.value}
              title={STATUS_CONFIG[stage.value]?.label || stage.short}
              className={`h-2 flex-1 rounded-full transition-colors ${
                reached ? stage.color : "bg-muted"
              } ${isCurrent ? "ring-2 ring-offset-1 ring-offset-background " + RING_COLORS[stage.value] : ""}`}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="font-medium">
          {current ? STATUS_CONFIG[current.value].label : STATUS_CONFIG[project.status]?.label || project.status}
        </span>
        {project.status === "in_progress" && phase && (
          <span className="text-muted-foreground">· {phase}</span>
        )}
        {project.status === "in_progress" && project.progress != null && project.progress > 0 && (
          <span className="text-muted-foreground tabular-nums">· {project.progress}%</span>
        )}
      </div>
    </div>
  );
}

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "Active" },
  { value: "contracted", label: "Contracted" },
  { value: "waiting_for_approval", label: "Waiting for Ryan" },
  { value: "estimating", label: "Estimating" },
  { value: "proposal_sent", label: "Proposal" },
  { value: "lead", label: "Lead" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function ProjectsView({ projects }: ProjectsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useSearchParamState("status", "all");
  const [viewMode, setViewMode] = useSearchParamState("view", "cards");
  const [deleteTarget, setDeleteTarget] = useState<ProjectData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteProject(deleteTarget.id);
    setDeleting(false);
    if (result.error) {
      setDeleteError(result.error);
    } else {
      setDeleteTarget(null);
      router.refresh();
    }
  }

  const projectValue = (p: ProjectData): number =>
    Number(p.contract_value) || Number(p.latest_estimate_total) || Number(p.estimated_value) || 0;

  // Totals per status across all projects — powers the per-pill counters
  // and the summary row. Built off the full list so counts don't shift
  // when Jorge types in the search box.
  const statusTotals = new Map<string, { count: number; value: number }>();
  let grandCount = 0;
  let grandValue = 0;
  for (const p of projects) {
    const v = projectValue(p);
    const existing = statusTotals.get(p.status) || { count: 0, value: 0 };
    existing.count += 1;
    existing.value += v;
    statusTotals.set(p.status, existing);
    grandCount += 1;
    grandValue += v;
  }
  const statValueFor = (opt: string): number =>
    opt === "all" ? grandValue : (statusTotals.get(opt)?.value || 0);
  const statCountFor = (opt: string): number =>
    opt === "all" ? grandCount : (statusTotals.get(opt)?.count || 0);

  const filtered = projects
    .filter((p) => {
      const matchesSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.customer?.last_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.city?.toLowerCase().includes(search.toLowerCase());

      const matchesStatus = statusFilter === "all" || p.status === statusFilter;

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));

  const currentStatusOption = FILTER_OPTIONS.find(o => o.value === statusFilter) ?? FILTER_OPTIONS[0];
  const currentCount = statCountFor(statusFilter);
  const currentValue = statValueFor(statusFilter);
  const fmtMoney = (n: number): string =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const returnUrl = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const projectHref = (projectId: string): string =>
    `/projects/${projectId}?returnUrl=${encodeURIComponent(returnUrl)}`;

  return (
    <div className="space-y-4">
      {/* Big hero search bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          placeholder="Search projects by name, client, or city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-12 pr-4 h-12 text-base rounded-xl bg-card border-border shadow-sm focus-visible:ring-2 focus-visible:ring-amber-500/40"
        />
      </div>

      {/* Filter pills + view toggle */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="-mx-4 flex flex-1 gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:rounded-lg sm:bg-muted sm:p-0.5">
          {FILTER_OPTIONS.map((opt) => {
            const count = statCountFor(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors inline-flex items-center gap-1.5 sm:rounded-md sm:border-0 sm:px-2.5 sm:py-1 ${
                  statusFilter === opt.value
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-600 shadow-sm dark:text-amber-400 sm:bg-background sm:text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground sm:bg-transparent"
                }`}
              >
                <span>{opt.label}</span>
                {count > 0 && (
                  <span className={`text-[10px] tabular-nums ${statusFilter === opt.value ? "text-amber-500" : "text-muted-foreground/70"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="hidden sm:flex bg-muted rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setViewMode("cards")}
            className={`p-1.5 rounded-md ${viewMode === "cards" ? "bg-background shadow-sm" : ""}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`p-1.5 rounded-md ${viewMode === "table" ? "bg-background shadow-sm" : ""}`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Summary strip — count + total $ for the active filter */}
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            {currentStatusOption.label}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {currentCount} project{currentCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-none">Total value</div>
          <div className="text-lg font-bold tabular-nums text-amber-500 leading-tight">{fmtMoney(currentValue)}</div>
        </div>
      </div>

      {/* Cards View */}
      {viewMode === "cards" ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              href={projectHref(project.id)}
              onDelete={setDeleteTarget}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-12">
              No projects found
            </p>
          )}
        </div>
      ) : (
        <ProjectTable
          projects={filtered}
          projectHref={projectHref}
          onDelete={setDeleteTarget}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.name}</strong>{" "}
              ({deleteTarget?.project_number})? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectCard({
  project,
  href,
  onDelete,
}: {
  project: ProjectData;
  href: string;
  onDelete: (project: ProjectData) => void;
}) {
  const status = STATUS_CONFIG[project.status] || { label: project.status, color: "bg-zinc-500" };
  const phase = project.phase ? PHASE_LABELS[project.phase] || project.phase : null;
  const clientName = project.customer
    ? `${project.customer.first_name} ${project.customer.last_name}`
    : null;
  const location = [project.city, project.state].filter(Boolean).join(", ");
  // Prefer the real number: signed contract > latest estimate total > initial guess
  const value = project.contract_value || project.latest_estimate_total || project.estimated_value;
  const isHot = (project.heatScore || 0) >= 3;

  return (
    <Card className={`hover:shadow-lg transition-all h-full overflow-hidden !py-0 group relative ${
      isHot ? "border-orange-500/40 hover:border-orange-500/60" : "hover:border-amber-500/30"
    }`}>
      <Link href={href} className="block">
        <div className="px-4 pt-4 pb-2 sm:px-6 sm:pt-5">
          <div className="flex items-center gap-2 min-w-0 pr-8">
            {isHot && <Flame className="h-4 w-4 text-orange-500 shrink-0" />}
            <h3 className="text-base font-semibold truncate">{project.name}</h3>
            <Badge
              variant="secondary"
              className={`${status.color} text-white text-[10px] shrink-0`}
            >
              {status.label}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{project.project_number}</p>
        </div>
        <CardContent className="space-y-2 px-4 pb-4 sm:px-6 sm:pb-5">
          {clientName && (
            <div className="flex items-center gap-1.5 text-sm">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{clientName}</span>
            </div>
          )}

          {location && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{project.address ? `${project.address}, ${location}` : location}</span>
            </div>
          )}

          {project.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {project.description}
            </p>
          )}

          {/* Progress bar */}
          {project.progress != null && project.progress > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Progress</span>
                <span className="font-medium">{project.progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    project.progress >= 100 ? "bg-green-500" : project.progress >= 50 ? "bg-amber-500" : "bg-sky-500"
                  }`}
                  style={{ width: `${Math.min(project.progress, 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div className="flex items-center gap-2">
              {phase && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <HardHat className="h-3 w-3" />
                  {phase}
                </div>
              )}
              <Badge variant="outline" className="text-[10px]">
                {project.project_type.replace(/_/g, " ")}
              </Badge>
            </div>
            {value && (
              <div className="flex items-center gap-0.5 text-sm font-medium text-green-500">
                <DollarSign className="h-3 w-3" />
                {Number(value).toLocaleString()}
              </div>
            )}
          </div>
        </CardContent>
      </Link>
      {/* Keep destructive actions reachable on touch devices. */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete(project);
        }}
        className="absolute top-3 right-3 h-9 w-9 rounded-md flex items-center justify-center text-muted-foreground/70 transition-colors hover:text-red-400 hover:bg-red-500/10 sm:top-4 sm:right-4 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        aria-label={`Delete ${project.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </Card>
  );
}

function ProjectTable({
  projects,
  projectHref,
  onDelete,
}: {
  projects: ProjectData[];
  projectHref: (projectId: string) => string;
  onDelete: (project: ProjectData) => void;
}) {
  const router = useRouter();

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-medium w-[26%]">Project</th>
            <th className="text-left p-3 font-medium w-[16%]">Client</th>
            <th className="text-left p-3 font-medium w-[30%]">Stage</th>
            <th className="text-right p-3 font-medium w-[12%]">Value</th>
            <th className="text-center p-3 font-medium w-[10%]">Proposal</th>
            <th className="p-3 w-[6%]" />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const client = p.customer ? `${p.customer.first_name} ${p.customer.last_name}` : "—";
            const location = [p.city, p.state].filter(Boolean).join(", ");
            const value = p.contract_value || p.latest_estimate_total || p.estimated_value;
            const isHot = (p.heatScore || 0) >= 3;

            return (
              <tr
                key={p.id}
                onClick={() => router.push(projectHref(p.id))}
                className="border-b hover:bg-muted/30 group cursor-pointer"
              >
                <td className="p-3 truncate">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isHot && <Flame className="h-3.5 w-3.5 text-orange-500 shrink-0" />}
                    <span className="font-medium truncate">{p.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{p.project_number}</div>
                </td>
                <td className="p-3 truncate">
                  <div className="text-muted-foreground truncate">{client}</div>
                  {location && (
                    <div className="text-xs text-muted-foreground/70 truncate">{location}</div>
                  )}
                </td>
                <td className="p-3 pr-6">
                  <StagePipeline project={p} />
                </td>
                <td className="p-3 text-right truncate font-medium tabular-nums">
                  {value ? `$${Number(value).toLocaleString()}` : "—"}
                </td>
                <td className="p-3 text-center">
                  {p.latest_estimate_id ? (
                    <Link
                      href={`/projects/${p.id}/estimates/${p.latest_estimate_id}?returnUrl=${encodeURIComponent(projectHref(p.id))}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:border-amber-500/60 transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Open
                    </Link>
                  ) : (
                    <span className="text-muted-foreground/50 text-xs">—</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(p);
                    }}
                    className="h-7 w-7 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 hover:bg-red-500/10 mx-auto"
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {projects.length === 0 && (
        <p className="text-muted-foreground text-center py-12">No projects found</p>
      )}
    </div>
  );
}

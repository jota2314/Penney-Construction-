"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between min-w-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <div className="flex bg-muted rounded-lg p-0.5 flex-wrap">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  statusFilter === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex bg-muted rounded-lg p-0.5">
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

          <span className="text-sm text-muted-foreground shrink-0">{filtered.length} projects</span>
        </div>
      </div>

      {/* Cards View */}
      {viewMode === "cards" ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
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
        <ProjectTable projects={filtered} onDelete={setDeleteTarget} />
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
  onDelete,
}: {
  project: ProjectData;
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
      <Link href={`/projects/${project.id}`} className="block">
        <div className="px-6 pt-5 pb-2">
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
        <CardContent className="space-y-2 pb-5">
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
      {/* Delete button — top right, visible on hover */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete(project);
        }}
        className="absolute top-4 right-4 h-8 w-8 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </Card>
  );
}

function ProjectTable({
  projects,
  onDelete,
}: {
  projects: ProjectData[];
  onDelete: (project: ProjectData) => void;
}) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-medium w-[28%]">Project</th>
            <th className="text-left p-3 font-medium w-[16%]">Client</th>
            <th className="text-left p-3 font-medium w-[16%]">Location</th>
            <th className="text-left p-3 font-medium w-[10%]">Status</th>
            <th className="text-left p-3 font-medium w-[10%]">Phase</th>
            <th className="text-right p-3 font-medium w-[12%]">Value</th>
            <th className="p-3 w-[8%]" />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const status = STATUS_CONFIG[p.status] || { label: p.status, color: "bg-zinc-500" };
            const phase = p.phase ? PHASE_LABELS[p.phase] || p.phase : "—";
            const client = p.customer ? `${p.customer.first_name} ${p.customer.last_name}` : "—";
            const location = [p.city, p.state].filter(Boolean).join(", ") || "—";
            const value = p.contract_value || p.latest_estimate_total || p.estimated_value;

            return (
              <tr key={p.id} className="border-b hover:bg-muted/30 group">
                <td className="p-3 truncate">
                  <Link href={`/projects/${p.id}`} className="hover:text-amber-500">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.project_number}</div>
                  </Link>
                </td>
                <td className="p-3 text-muted-foreground truncate">{client}</td>
                <td className="p-3 text-muted-foreground truncate">{location}</td>
                <td className="p-3">
                  <Badge variant="secondary" className={`${status.color} text-white text-[10px]`}>
                    {status.label}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground truncate">{phase}</td>
                <td className="p-3 text-right truncate">
                  {value ? `$${Number(value).toLocaleString()}` : "—"}
                </td>
                <td className="p-3 text-center">
                  <button
                    onClick={() => onDelete(p)}
                    className="h-7 w-7 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 hover:bg-red-500/10 mx-auto"
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

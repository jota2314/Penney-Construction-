"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { Estimate } from "@/types/database";

// Status model is the PROJECT status, not estimate.status — same pills
// as on the projects page.
const PROJECT_STATUS_LABELS: Record<string, string> = {
  lead: "Lead",
  estimating: "Estimating",
  waiting_for_approval: "Waiting for Ryan",
  proposal_sent: "Proposal",
  contracted: "Contracted",
  in_progress: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};
const PROJECT_STATUS_COLORS: Record<string, string> = {
  lead: "bg-zinc-500 text-white",
  estimating: "bg-amber-500 text-white",
  waiting_for_approval: "bg-orange-500 text-white",
  proposal_sent: "bg-purple-500 text-white",
  contracted: "bg-blue-500 text-white",
  in_progress: "bg-green-500 text-white",
  completed: "bg-emerald-700 text-white",
  cancelled: "bg-red-500 text-white",
};
const FILTER_ORDER = [
  "all",
  "in_progress",
  "contracted",
  "waiting_for_approval",
  "estimating",
  "proposal_sent",
  "lead",
  "completed",
  "cancelled",
];

interface EstimateWithContext extends Estimate {
  project?: { name: string; project_number: string; status?: string } | null;
  lead?: { first_name: string; last_name: string; lead_number: string } | null;
}

interface EstimateListProps {
  estimates: EstimateWithContext[];
}

// Multi-status buckets that the dashboard KPI cards link into.
const STAGE_BUCKETS: Record<string, Set<string>> = {
  open: new Set(["lead", "estimating", "waiting_for_approval", "proposal_sent"]),
  won: new Set(["contracted", "in_progress"]),
};

export function EstimateList({ estimates }: EstimateListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const stage = searchParams.get("stage"); // "open" or "won" — multi-status buckets

  function handleStatusFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("stage"); // picking a specific status clears the bucket
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    router.push(`/estimates?${params.toString()}`);
  }

  const filtered = (() => {
    if (stage && STAGE_BUCKETS[stage]) {
      return estimates.filter(e => STAGE_BUCKETS[stage].has(e.project?.status || ""));
    }
    if (statusFilter === "all") return estimates;
    return estimates.filter((e) => (e.project?.status || "") === statusFilter);
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            {FILTER_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All Statuses" : PROJECT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden md:table-cell">Project / Lead</TableHead>
              <TableHead>Estimate</TableHead>
              <TableHead className="hidden md:table-cell">Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  {estimates.length === 0
                    ? "No estimates yet."
                    : "No estimates match the selected filter."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((est) => (
                <TableRow key={est.id}>
                  <TableCell className="hidden md:table-cell">
                    {est.project_id && est.project ? (
                      <Link
                        href={`/projects/${est.project_id}`}
                        className="hover:underline text-sm"
                      >
                        <span className="font-mono">
                          {est.project.project_number}
                        </span>{" "}
                        - {est.project.name}
                      </Link>
                    ) : est.lead ? (
                      <Link
                        href={`/crm/leads/${est.lead_id}`}
                        className="hover:underline text-sm"
                      >
                        <span className="font-mono">
                          {est.lead.lead_number}
                        </span>{" "}
                        - {est.lead.first_name} {est.lead.last_name}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={
                        est.project_id
                          ? `/projects/${est.project_id}/estimates/${est.id}`
                          : `/estimates/${est.id}`
                      }
                      className="hover:underline"
                    >
                      {est.name}
                    </Link>
                    <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                      {est.project_id && est.project
                        ? `${est.project.project_number} · `
                        : est.lead
                          ? `${est.lead.lead_number} · `
                          : ""}
                      v{est.version}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">v{est.version}</TableCell>
                  <TableCell>
                    {(() => {
                      const ps = est.project?.status || "";
                      const label = PROJECT_STATUS_LABELS[ps] || ps || "—";
                      const color = PROJECT_STATUS_COLORS[ps] || "bg-muted text-muted-foreground";
                      return (
                        <Badge className={`${color} text-[10px]`}>{label}</Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(est.total_price)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

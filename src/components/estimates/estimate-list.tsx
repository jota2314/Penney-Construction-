"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { EstimateStatusBadge } from "./estimate-status-badge";
import {
  ALL_ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
} from "@/lib/constants/estimate";
import type { Estimate } from "@/types/database";

interface EstimateWithContext extends Estimate {
  project?: { name: string; project_number: string } | null;
  lead?: { first_name: string; last_name: string; lead_number: string } | null;
}

interface EstimateListProps {
  estimates: EstimateWithContext[];
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

export function EstimateList({ estimates }: EstimateListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";

  function handleStatusFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    router.push(`/estimates?${params.toString()}`);
  }

  const filtered =
    statusFilter === "all"
      ? estimates
      : estimates.filter((e) => e.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {ALL_ESTIMATE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ESTIMATE_STATUS_LABELS[s]}
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
                    <EstimateStatusBadge status={est.status} />
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

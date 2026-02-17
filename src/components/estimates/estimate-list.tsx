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

interface EstimateWithProject extends Estimate {
  project?: { name: string; project_number: string } | null;
}

interface EstimateListProps {
  estimates: EstimateWithProject[];
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
          <SelectTrigger className="w-[180px]">
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
              <TableHead>Project</TableHead>
              <TableHead>Estimate</TableHead>
              <TableHead>Version</TableHead>
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
                    ? "No estimates yet. Create one from a project detail page."
                    : "No estimates match the selected filter."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((est) => (
                <TableRow key={est.id}>
                  <TableCell>
                    <Link
                      href={`/projects/${est.project_id}`}
                      className="hover:underline text-sm"
                    >
                      <span className="font-mono">
                        {est.project?.project_number}
                      </span>{" "}
                      - {est.project?.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${est.project_id}/estimates/${est.id}`}
                      className="hover:underline"
                    >
                      {est.name}
                    </Link>
                  </TableCell>
                  <TableCell>v{est.version}</TableCell>
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

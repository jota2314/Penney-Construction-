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
import { LeadStatusBadge } from "./lead-status-badge";
import {
  ALL_LEAD_STATUSES,
  LEAD_STATUS_LABELS,
} from "@/lib/constants/lead";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { Lead } from "@/types/database";

interface LeadListProps {
  leads: Lead[];
}

export function LeadList({ leads }: LeadListProps) {
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
    router.push(`/crm/leads?${params.toString()}`);
  }

  const filtered =
    statusFilter === "all"
      ? leads
      : leads.filter((l) => l.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {ALL_LEAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead #</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  {leads.length === 0
                    ? "No leads yet. Create one to get started."
                    : "No leads match the selected filter."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-mono text-sm">
                    <Link
                      href={`/crm/leads/${lead.id}`}
                      className="hover:underline"
                    >
                      {lead.lead_number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/crm/leads/${lead.id}`}
                      className="hover:underline"
                    >
                      {lead.first_name} {lead.last_name}
                    </Link>
                    <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                      {[
                        lead.phone,
                        lead.project_type ? PROJECT_TYPE_LABELS[lead.project_type] : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || ""}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{lead.phone ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {lead.project_type
                      ? PROJECT_TYPE_LABELS[lead.project_type]
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <LeadStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {new Date(lead.created_at).toLocaleDateString()}
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

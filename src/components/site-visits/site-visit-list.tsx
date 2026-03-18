"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SiteVisitStatusBadge } from "./site-visit-status-badge";
import { SiteVisitTypeBadge } from "./site-visit-type-badge";
import type { SiteVisit, Project } from "@/types/database";

interface SiteVisitWithProject extends SiteVisit {
  project?: Pick<Project, "project_number" | "name"> | null;
}

interface SiteVisitListProps {
  siteVisits: SiteVisitWithProject[];
}

export function SiteVisitList({ siteVisits }: SiteVisitListProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Project</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden md:table-cell">Purpose</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {siteVisits.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground py-8"
              >
                No site visits yet.
              </TableCell>
            </TableRow>
          ) : (
            siteVisits.map((visit) => (
              <TableRow key={visit.id}>
                <TableCell>
                  <Link
                    href={`/site-visits/${visit.id}`}
                    className="hover:underline text-sm font-medium"
                  >
                    {new Date(visit.visited_at).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    at{" "}
                    {new Date(visit.visited_at).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Link>
                </TableCell>
                <TableCell>
                  {visit.project ? (
                    <span className="text-sm">
                      <span className="font-mono">
                        {visit.project.project_number}
                      </span>{" "}
                      — {visit.project.name}
                    </span>
                  ) : (
                    "—"
                  )}
                  {visit.purpose && (
                    <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                      {visit.purpose}
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <SiteVisitTypeBadge type={visit.visit_type} siteVisitId={visit.id} />
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm">
                  {visit.purpose || "—"}
                </TableCell>
                <TableCell>
                  <SiteVisitStatusBadge status={visit.status} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

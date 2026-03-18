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
import { WalkthroughStatusBadge } from "./walkthrough-status-badge";
import type { Walkthrough } from "@/types/database";

interface WalkthroughListProps {
  walkthroughs: Walkthrough[];
}

export function WalkthroughList({ walkthroughs }: WalkthroughListProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Address</TableHead>
            <TableHead className="hidden md:table-cell">Purpose</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {walkthroughs.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground py-8"
              >
                No walkthroughs yet.
              </TableCell>
            </TableRow>
          ) : (
            walkthroughs.map((wt) => (
              <TableRow key={wt.id}>
                <TableCell>
                  <Link
                    href={`/walkthroughs/${wt.id}`}
                    className="hover:underline text-sm font-medium"
                  >
                    {new Date(wt.visited_at).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    at{" "}
                    {new Date(wt.visited_at).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="text-sm font-medium">{wt.name}</span>
                  {wt.purpose && (
                    <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                      {wt.purpose}
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm">
                  {wt.address ? (
                    <span>
                      {wt.address}
                      {wt.city ? `, ${wt.city}` : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm">
                  {wt.purpose || "—"}
                </TableCell>
                <TableCell>
                  <WalkthroughStatusBadge status={wt.status} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

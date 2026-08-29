"use client";

import Link from "next/link";
import { AddressLink } from "@/components/ui/address-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MeetingStatusBadge } from "./meeting-status-badge";
import type { Meeting, Lead } from "@/types/database";

interface MeetingWithLead extends Meeting {
  lead?: Pick<Lead, "lead_number" | "first_name" | "last_name"> | null;
}

interface MeetingListProps {
  meetings: MeetingWithLead[];
}

export function MeetingList({ meetings }: MeetingListProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date & Time</TableHead>
            <TableHead>Lead</TableHead>
            <TableHead className="hidden md:table-cell">Address</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {meetings.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-center text-muted-foreground py-8"
              >
                No meetings scheduled.
              </TableCell>
            </TableRow>
          ) : (
            meetings.map((meeting) => (
              <TableRow key={meeting.id}>
                <TableCell>
                  <Link
                    href={`/crm/meetings/${meeting.id}`}
                    className="hover:underline text-sm font-medium"
                  >
                    {new Date(meeting.scheduled_at).toLocaleDateString(
                      "en-US",
                      {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      }
                    )}{" "}
                    at{" "}
                    {new Date(meeting.scheduled_at).toLocaleTimeString(
                      "en-US",
                      {
                        hour: "numeric",
                        minute: "2-digit",
                      }
                    )}
                  </Link>
                </TableCell>
                <TableCell>
                  {meeting.lead ? (
                    <Link
                      href={`/crm/leads/${meeting.lead_id}`}
                      className="hover:underline text-sm"
                    >
                      <span className="font-mono">
                        {meeting.lead.lead_number}
                      </span>{" "}
                      — {meeting.lead.first_name} {meeting.lead.last_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                  {meeting.address && (
                    <AddressLink
                      address={meeting.address}
                      city={meeting.city}
                      className="md:hidden block text-xs text-muted-foreground mt-0.5 hover:text-amber-500"
                    />
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm">
                  {meeting.address ? (
                    <AddressLink
                      address={meeting.address}
                      city={meeting.city}
                      className="hover:text-amber-500"
                    />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <MeetingStatusBadge status={meeting.status} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

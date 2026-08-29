"use client";

import { useState } from "react";
import Link from "next/link";
import { AddressLink } from "@/components/ui/address-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadStatusBadge } from "./lead-status-badge";
import { LeadFormDialog } from "./lead-form-dialog";
import { LeadDeleteDialog } from "./lead-delete-dialog";
import { ScheduleMeetingDialog } from "./schedule-meeting-dialog";
import { ConvertLeadDialog } from "./convert-lead-dialog";
import { MeetingStatusBadge } from "@/components/meetings/meeting-status-badge";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import { REFERRAL_SOURCE_LABELS, URGENCY_LABELS } from "@/lib/constants/lead";
import {
  Pencil,
  Trash2,
  CalendarPlus,
  Calculator,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Lead, Meeting } from "@/types/database";

interface LeadDetailProps {
  lead: Lead;
  meetings: Meeting[];
}

export function LeadDetail({ lead, meetings }: LeadDetailProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const isConverted = lead.status === "converted";
  const isLost = lead.status === "lost";
  const isEstimating = lead.status === "estimating";
  const canCreateEstimate = !isConverted && !isLost && !isEstimating && !lead.estimate_id;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">
              {lead.first_name} {lead.last_name}
            </h2>
            <LeadStatusBadge status={lead.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {lead.lead_number}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isConverted && !isLost && (
            <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
              <CalendarPlus className="mr-2 h-4 w-4" />
              Schedule Meeting
            </Button>
          )}
          {canCreateEstimate && (
            <Button size="sm" onClick={() => setConvertOpen(true)}>
              <Calculator className="mr-2 h-4 w-4" />
              Create Estimate
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Converted banner */}
      {isConverted && lead.project_id && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3 flex items-center justify-between">
            <p className="text-sm text-green-800">
              This lead has been converted to a project.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${lead.project_id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                View Project
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Estimating banner */}
      {isEstimating && lead.estimate_id && (
        <Card className="border-indigo-200 bg-indigo-50">
          <CardContent className="py-3 flex items-center justify-between">
            <p className="text-sm text-indigo-800">
              An estimate is being prepared for this lead.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/estimates/${lead.estimate_id}`}>
                <Calculator className="mr-2 h-4 w-4" />
                View Estimate
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Contact Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {lead.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {lead.phone}
              </div>
            )}
            {lead.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {lead.email}
              </div>
            )}
            {lead.address && (
              <AddressLink
                address={lead.address}
                city={lead.city}
                state={lead.state}
                zip={lead.zip}
                className="flex items-center gap-2 text-sm hover:text-amber-500"
              >
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  {lead.address}
                  {lead.city && `, ${lead.city}`}
                  {lead.state && `, ${lead.state}`}
                  {lead.zip && ` ${lead.zip}`}
                </span>
              </AddressLink>
            )}
            {!lead.phone && !lead.email && !lead.address && (
              <p className="text-sm text-muted-foreground">
                No contact details provided.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Project Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Project Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {lead.project_type && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Type</span>
                <span>{PROJECT_TYPE_LABELS[lead.project_type]}</span>
              </div>
            )}
            {lead.description && (
              <div className="text-sm">
                <span className="text-muted-foreground">Description</span>
                <p className="mt-1">{lead.description}</p>
              </div>
            )}
            {(lead.budget_min || lead.budget_max) && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Budget</span>
                <span>
                  {lead.budget_min ? formatCurrency(lead.budget_min) : "?"}
                  {" — "}
                  {lead.budget_max ? formatCurrency(lead.budget_max) : "?"}
                </span>
              </div>
            )}
            {lead.urgency && lead.urgency !== "unknown" && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Urgency</span>
                <Badge variant="secondary">{URGENCY_LABELS[lead.urgency]}</Badge>
              </div>
            )}
            {lead.referral_source && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Referral</span>
                <span>
                  {REFERRAL_SOURCE_LABELS[lead.referral_source]}
                  {lead.referral_detail && ` — ${lead.referral_detail}`}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Meetings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Meetings</CardTitle>
            <CardDescription>Site visits and consultations</CardDescription>
          </div>
          {!isConverted && !isLost && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScheduleOpen(true)}
            >
              <CalendarPlus className="mr-2 h-4 w-4" />
              Schedule
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No meetings scheduled yet.
            </p>
          ) : (
            <div className="space-y-3">
              {meetings.map((meeting) => (
                <Link
                  key={meeting.id}
                  href={`/crm/meetings/${meeting.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {new Date(meeting.scheduled_at).toLocaleDateString(
                        "en-US",
                        {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
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
                    </p>
                    <AddressLink
                      address={meeting.address}
                      city={meeting.city}
                      className="block text-xs text-muted-foreground mt-0.5 hover:text-amber-500"
                    />
                  </div>
                  <MeetingStatusBadge status={meeting.status} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <LeadFormDialog open={editOpen} onOpenChange={setEditOpen} lead={lead} />
      <LeadDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        lead={lead}
        redirectOnDelete
      />
      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        lead={lead}
      />
      <ConvertLeadDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={lead}
      />
    </>
  );
}

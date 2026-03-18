"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MeetingStatusBadge } from "./meeting-status-badge";
import { MeetingDeleteDialog } from "./meeting-delete-dialog";
import { MeetingNotesPanel } from "./meeting-notes-panel";
import { MeetingPhotosPanel } from "./meeting-photos-panel";
import { MeetingSummaryPanel } from "./meeting-summary-panel";
import { MeetingQuestionsPanel } from "./meeting-questions-panel";
import { completeMeeting } from "@/lib/actions/meetings";
import { createEstimateFromLead } from "@/lib/actions/leads";
import { createWalkthrough } from "@/lib/actions/walkthroughs";
import {
  MapPin,
  Calendar,
  ArrowLeft,
  CheckCircle,
  Trash2,
  Calculator,
  ClipboardList,
} from "lucide-react";
import type { Meeting, MeetingNote, MeetingFile, MeetingQuestion, Lead } from "@/types/database";

interface MeetingDetailProps {
  meeting: Meeting;
  lead: Lead;
  notes: MeetingNote[];
  files: MeetingFile[];
  questions: MeetingQuestion[];
  walkthroughId?: string | null;
}

export function MeetingDetail({
  meeting,
  lead,
  notes,
  files,
  questions,
  walkthroughId,
}: MeetingDetailProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [creatingEstimate, setCreatingEstimate] = useState(false);
  const [startingWalkthrough, setStartingWalkthrough] = useState(false);

  const isScheduled = meeting.status === "scheduled";
  const isCompleted = meeting.status === "completed";
  const clientName = `${lead.first_name} ${lead.last_name}`;
  const address = meeting.address
    ? `${meeting.address}${meeting.city ? `, ${meeting.city}` : ""}${meeting.state ? `, ${meeting.state}` : ""}${meeting.zip ? ` ${meeting.zip}` : ""}`
    : null;

  const canCreateEstimate =
    isCompleted &&
    !lead.estimate_id &&
    lead.status !== "converted" &&
    lead.status !== "estimating";

  async function handleComplete() {
    setCompleting(true);
    await completeMeeting(meeting.id, meeting.lead_id);
    setCompleting(false);
  }

  async function handleStartWalkthrough() {
    setStartingWalkthrough(true);
    const result = await createWalkthrough({
      name: `${clientName} — Walkthrough`,
      meeting_id: meeting.id,
      address: meeting.address || lead.address || undefined,
      city: meeting.city || lead.city || undefined,
      state: meeting.state || lead.state || undefined,
      zip: meeting.zip || lead.zip || undefined,
    });
    setStartingWalkthrough(false);
    if (!result.error && result.id) {
      router.push(`/walkthroughs/${result.id}`);
    }
  }

  async function handleCreateEstimate() {
    setCreatingEstimate(true);
    const result = await createEstimateFromLead(lead.id);
    setCreatingEstimate(false);
    if (!result.error && result.estimateId) {
      router.push(`/estimates/${result.estimateId}`);
    }
  }

  return (
    <>
      {/* Back link */}
      <Link
        href={`/crm/leads/${lead.id}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        {clientName} ({lead.lead_number})
      </Link>

      {/* Header - mobile friendly */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">Meeting</h2>
            <MeetingStatusBadge status={meeting.status} />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Meeting info card */}
        <Card>
          <CardContent className="py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {new Date(meeting.scheduled_at).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}{" "}
              at{" "}
              {new Date(meeting.scheduled_at).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
            {address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {address}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mark complete button - large touch target */}
        {isScheduled && (
          <Button
            size="lg"
            className="w-full h-12 text-base"
            disabled={completing}
            onClick={handleComplete}
          >
            <CheckCircle className="mr-2 h-5 w-5" />
            {completing ? "Completing..." : "Mark Complete"}
          </Button>
        )}

        {/* Start Walkthrough button — or link to existing one */}
        {isCompleted && !walkthroughId && (
          <Button
            size="lg"
            variant="outline"
            className="w-full h-12 text-base"
            disabled={startingWalkthrough}
            onClick={handleStartWalkthrough}
          >
            <ClipboardList className="mr-2 h-5 w-5" />
            {startingWalkthrough ? "Starting..." : "Start Walkthrough"}
          </Button>
        )}
        {isCompleted && walkthroughId && (
          <Button
            size="lg"
            variant="outline"
            className="w-full h-12 text-base"
            asChild
          >
            <Link href={`/walkthroughs/${walkthroughId}`}>
              <ClipboardList className="mr-2 h-5 w-5" />
              View Walkthrough
            </Link>
          </Button>
        )}

        {/* Create Estimate button */}
        {canCreateEstimate && (
          <Button
            size="lg"
            className="w-full h-12 text-base"
            disabled={creatingEstimate}
            onClick={handleCreateEstimate}
          >
            <Calculator className="mr-2 h-5 w-5" />
            {creatingEstimate ? "Creating Estimate..." : "Create Estimate"}
          </Button>
        )}
      </div>

      {/* Tabs - main content area */}
      <Tabs defaultValue="notes" className="mt-4">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="notes" className="min-h-[44px] text-xs sm:text-sm">
            Notes ({notes.length})
          </TabsTrigger>
          <TabsTrigger value="photos" className="min-h-[44px] text-xs sm:text-sm">
            Photos ({files.length})
          </TabsTrigger>
          <TabsTrigger value="summary" className="min-h-[44px] text-xs sm:text-sm">
            Summary
          </TabsTrigger>
          <TabsTrigger value="questions" className="min-h-[44px] text-xs sm:text-sm">
            Q&A {questions.length > 0 ? `(${questions.filter((q) => q.answer).length}/${questions.length})` : ""}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="notes" className="mt-4">
          <MeetingNotesPanel meetingId={meeting.id} notes={notes} />
        </TabsContent>
        <TabsContent value="photos" className="mt-4">
          <MeetingPhotosPanel
            meetingId={meeting.id}
            leadId={meeting.lead_id}
            files={files}
          />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Meeting Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <MeetingSummaryPanel
                meetingId={meeting.id}
                summary={meeting.summary}
                notes={notes}
                files={files}
                projectType={lead.project_type}
                clientName={clientName}
                address={address}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="questions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Follow-Up Questions</CardTitle>
            </CardHeader>
            <CardContent>
              <MeetingQuestionsPanel
                meetingId={meeting.id}
                summary={meeting.summary}
                notes={notes}
                questions={questions}
                projectType={lead.project_type}
                clientName={clientName}
                address={address}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete dialog */}
      <MeetingDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        meeting={meeting}
        redirectOnDelete
      />
    </>
  );
}

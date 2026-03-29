"use client";

import { useState } from "react";
import Link from "next/link";
import { buildAddress } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WalkthroughStatusBadge } from "./walkthrough-status-badge";
import { WalkthroughDeleteDialog } from "./walkthrough-delete-dialog";
import { WalkthroughCapturePanel } from "./walkthrough-capture-panel";
import { WalkthroughReviewPanel } from "./walkthrough-review-panel";
import { completeWalkthrough } from "@/lib/actions/walkthroughs";
import {
  ArrowLeft,
  CheckCircle,
  Trash2,
  MapPin,
} from "lucide-react";
import type { Walkthrough, WalkthroughNote, WalkthroughFile } from "@/types/database";

interface WalkthroughDetailProps {
  walkthrough: Walkthrough;
  notes: WalkthroughNote[];
  files: WalkthroughFile[];
}

export function WalkthroughDetail({
  walkthrough,
  notes: initialNotes,
  files: initialFiles,
}: WalkthroughDetailProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [liveNotes, setLiveNotes] = useState(initialNotes);
  const [liveFiles, setLiveFiles] = useState(initialFiles);

  const isInProgress = walkthrough.status === "in_progress";

  const address = buildAddress(walkthrough.address, walkthrough.city, walkthrough.state, walkthrough.zip);

  async function handleComplete() {
    setCompleting(true);
    await completeWalkthrough(walkthrough.id);
    setCompleting(false);
  }

  return (
    <>
      {/* Back link */}
      <Link
        href="/walkthroughs"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        All Walkthroughs
      </Link>

      {/* Compact header bar */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">
              {walkthrough.name}
            </span>
            {walkthrough.estimate_id && (
              <Link
                href={`/estimates/${walkthrough.estimate_id}`}
                className="text-xs text-muted-foreground hover:underline"
              >
                View Estimate
              </Link>
            )}
            <WalkthroughStatusBadge status={walkthrough.status} />
          </div>
          {address && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              {address}
            </p>
          )}
          {walkthrough.purpose && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {walkthrough.purpose}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isInProgress && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={completing}
              onClick={handleComplete}
            >
              <CheckCircle className="mr-1 h-3.5 w-3.5" />
              {completing ? "..." : "Complete"}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs: Capture | Review | Report */}
      <Tabs defaultValue="capture" className="mt-2">
        <TabsList className="w-full grid grid-cols-3 !h-auto !p-1 rounded-lg bg-muted/50 border border-border">
          <TabsTrigger
            value="capture"
            className="!h-9 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
          >
            Capture
          </TabsTrigger>
          <TabsTrigger
            value="review"
            className="!h-9 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
          >
            Review
          </TabsTrigger>
          <TabsTrigger
            value="report"
            className="!h-9 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
          >
            Report
          </TabsTrigger>
        </TabsList>
        <TabsContent value="capture" className="mt-3">
          <WalkthroughCapturePanel
            walkthroughId={walkthrough.id}
            notes={liveNotes}
            files={liveFiles}
            onNotesChange={setLiveNotes}
            onFilesChange={setLiveFiles}
          />
        </TabsContent>
        <TabsContent value="review" className="mt-3">
          <WalkthroughReviewPanel
            walkthroughId={walkthrough.id}
            summary={walkthrough.summary}
            notes={liveNotes}
            files={liveFiles}
            walkthroughName={walkthrough.name}
            address={address}
            visitDate={walkthrough.visited_at}
            purpose={walkthrough.purpose}
          />
        </TabsContent>
        <TabsContent value="report" className="mt-3">
          <WalkthroughReviewPanel
            walkthroughId={walkthrough.id}
            summary={walkthrough.summary}
            notes={liveNotes}
            files={liveFiles}
            walkthroughName={walkthrough.name}
            address={address}
            visitDate={walkthrough.visited_at}
            purpose={walkthrough.purpose}
            reportMode
          />
        </TabsContent>
      </Tabs>

      {/* Delete dialog */}
      <WalkthroughDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        walkthrough={walkthrough}
        redirectOnDelete
      />
    </>
  );
}

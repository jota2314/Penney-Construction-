"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveMeetingSummary } from "@/lib/actions/meetings";
import { Sparkles, Save, Loader2 } from "lucide-react";
import type { MeetingNote, MeetingFile } from "@/types/database";

interface MeetingSummaryPanelProps {
  meetingId: string;
  summary: string | null;
  notes: MeetingNote[];
  files: MeetingFile[];
  projectType?: string | null;
  clientName?: string;
  address?: string | null;
}

export function MeetingSummaryPanel({
  meetingId,
  summary: initialSummary,
  notes,
  files,
  projectType,
  clientName,
  address,
}: MeetingSummaryPanelProps) {
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (notes.length === 0) {
      setError("Add some notes before generating a summary.");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/generate-meeting-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes.map((n) => ({ content: n.content, source: n.source })),
          projectType,
          clientName,
          address,
          fileUrls: [], // Photos aren't passed as URLs for now (private bucket)
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to generate summary");
      } else {
        setSummary(data.summary);
        // Auto-save
        await saveMeetingSummary(meetingId, data.summary);
      }
    } catch {
      setError("Failed to generate summary. Please try again.");
    }

    setGenerating(false);
  }

  async function handleSave() {
    setSaving(true);
    const result = await saveMeetingSummary(meetingId, summary);
    setSaving(false);

    if (result.error) {
      setError(result.error);
    }
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        size="lg"
        className="w-full h-14 text-base"
        disabled={generating || notes.length === 0}
        onClick={handleGenerate}
      >
        {generating ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Generating Summary...
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-5 w-5" />
            Generate AI Summary
          </>
        )}
      </Button>

      {notes.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          Add notes first, then generate a summary.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {summary && (
        <>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={20}
            className="font-mono text-sm"
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Summary
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
}

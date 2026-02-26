"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveSiteVisitSummary } from "@/lib/actions/site-visits";
import { Sparkles, Save, Loader2 } from "lucide-react";
import type { SiteVisitNote, SiteVisitFile } from "@/types/database";

interface SiteVisitSummaryPanelProps {
  siteVisitId: string;
  summary: string | null;
  notes: SiteVisitNote[];
  files: SiteVisitFile[];
  projectName?: string;
  projectType?: string | null;
  address?: string | null;
}

export function SiteVisitSummaryPanel({
  siteVisitId,
  summary: initialSummary,
  notes,
  files,
  projectName,
  projectType,
  address,
}: SiteVisitSummaryPanelProps) {
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
      const res = await fetch("/api/generate-site-visit-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes.map((n) => ({ content: n.content, source: n.source })),
          projectName,
          projectType,
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
        await saveSiteVisitSummary(siteVisitId, data.summary);
      }
    } catch {
      setError("Failed to generate summary. Please try again.");
    }

    setGenerating(false);
  }

  async function handleSave() {
    setSaving(true);
    const result = await saveSiteVisitSummary(siteVisitId, summary);
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

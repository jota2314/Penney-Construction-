"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { TakeoffViewer, type SavedMeasurement, type TakeoffChecklistItem } from "./takeoff-viewer";

interface TakeoffPageProps {
  projectId: string;
  projectName: string;
  pdfUrl: string;
  filename: string;
  storagePath: string;
  backHref: string;
  drawingText?: string;
  scopeOfWork?: string;
  initialMeasurements: SavedMeasurement[];
  initialChecklist?: TakeoffChecklistItem[];
  scalePixelsPerFoot?: number;
}

export function TakeoffPage({
  projectId,
  pdfUrl,
  filename,
  storagePath,
  backHref,
  drawingText,
  scopeOfWork,
  initialMeasurements,
  initialChecklist,
  scalePixelsPerFoot,
}: TakeoffPageProps) {
  const router = useRouter();
  const versions = useRef(initialMeasurements.map(m => ({ id: m.id, updatedAt: m.updatedAt ?? null })));

  const handleSave = useCallback(async (
    measurements: SavedMeasurement[],
    scale: number | null,
    checklist?: TakeoffChecklistItem[]
  ) => {
    const res = await fetch("/api/save-takeoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        storagePath,
        measurements: measurements.map(m => ({ ...m, scalePixelsPerFoot: m.scalePixelsPerFoot ?? scale })),
        expected: versions.current,
        scalePixelsPerFoot: scale,
      }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Save failed");
    versions.current = result.versions;
  }, [projectId, storagePath]);

  return (
    <TakeoffViewer
      pdfUrl={pdfUrl}
      filename={filename}
      initialMeasurements={initialMeasurements}
      initialChecklist={initialChecklist}
      projectId={projectId}
      storagePath={storagePath}
      initialScale={scalePixelsPerFoot}
      drawingText={drawingText}
      scopeOfWork={scopeOfWork}
      onSave={handleSave}
      onClose={() => router.push(backHref)}
    />
  );
}

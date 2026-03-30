"use client";

import { useRouter } from "next/navigation";
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

  async function handleSave(
    measurements: SavedMeasurement[],
    scale: number | null,
    checklist?: TakeoffChecklistItem[]
  ) {
    const res = await fetch("/api/save-takeoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        storagePath,
        measurements,
        checklist,
        scalePixelsPerFoot: scale,
      }),
    });
    if (!res.ok) throw new Error("Save failed");
  }

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

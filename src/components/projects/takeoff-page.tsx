"use client";

import { useRouter } from "next/navigation";
import { TakeoffViewer, type SavedMeasurement } from "./takeoff-viewer";

interface TakeoffPageProps {
  projectId: string;
  projectName: string;
  pdfUrl: string;
  filename: string;
  storagePath: string;
  backHref: string;
  initialMeasurements: SavedMeasurement[];
  scalePixelsPerFoot?: number;
}

export function TakeoffPage({
  projectId,
  pdfUrl,
  filename,
  storagePath,
  backHref,
  initialMeasurements,
  scalePixelsPerFoot,
}: TakeoffPageProps) {
  const router = useRouter();

  async function handleSave(measurements: SavedMeasurement[], scale: number | null) {
    const res = await fetch("/api/save-takeoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        storagePath,
        measurements,
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
      initialScale={scalePixelsPerFoot}
      onSave={handleSave}
      onClose={() => router.push(backHref)}
    />
  );
}

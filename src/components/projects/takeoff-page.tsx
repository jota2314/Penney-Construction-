"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
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
  projectName,
  pdfUrl,
  filename,
  storagePath,
  backHref,
  initialMeasurements,
  scalePixelsPerFoot,
}: TakeoffPageProps) {
  const router = useRouter();

  async function handleSave(measurements: SavedMeasurement[]) {
    try {
      const res = await fetch("/api/save-takeoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          storagePath,
          measurements,
          scalePixelsPerFoot: measurements.length > 0 ? scalePixelsPerFoot : undefined,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch (err) {
      console.error("Failed to save takeoff:", err);
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <Header title={`Takeoff — ${filename}`} backHref={backHref} />
      <div className="flex-1 min-h-0">
        <TakeoffViewer
          pdfUrl={pdfUrl}
          filename={filename}
          initialMeasurements={initialMeasurements}
          onSave={handleSave}
          onClose={() => router.push(backHref)}
        />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { TakeoffPage } from "@/components/projects/takeoff-page";

export const metadata: Metadata = { title: "Takeoff | Penney Construction" };

export default async function TakeoffRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string; filename?: string; bucket?: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const { path, filename, bucket } = await searchParams;

  if (!path) redirect(`/projects/${id}/estimates/drawings`);

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .single();
  if (!project) notFound();

  // Generate signed URL for the PDF
  const storageBucket = bucket || "email-attachments";
  const { data: urlData } = await supabase.storage
    .from(storageBucket)
    .createSignedUrl(path, 7200); // 2 hour expiry for long takeoff sessions

  if (!urlData?.signedUrl) redirect(`/projects/${id}/estimates/drawings`);

  // Load existing measurements for this file
  const { data: measurements } = await supabase
    .from("takeoff_measurements")
    .select("*")
    .eq("project_id", id)
    .eq("storage_path", path)
    .order("created_at");

  return (
    <TakeoffPage
      projectId={id}
      projectName={project.name}
      pdfUrl={urlData.signedUrl}
      filename={filename || path.split("/").pop() || "Drawing"}
      storagePath={path}
      backHref={`/projects/${id}/estimates/drawings`}
      initialMeasurements={(measurements ?? []).map((m) => ({
        id: m.id,
        type: m.measurement_type as "linear" | "area" | "count",
        label: m.label,
        points: (m.points as { x: number; y: number }[]) || [],
        value: Number(m.value) || 0,
        unit: m.unit || "ft",
        color: m.color || "#F59E0B",
        pageNumber: m.page_number || 1,
      }))}
      scalePixelsPerFoot={
        measurements?.find((m) => m.scale_pixels_per_foot)
          ? Number(measurements.find((m) => m.scale_pixels_per_foot)!.scale_pixels_per_foot)
          : undefined
      }
    />
  );
}

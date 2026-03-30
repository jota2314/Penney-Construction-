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

  const [{ data: project }, { data: measurements }] = await Promise.all([
    supabase.from("projects").select("id, name, scope_of_work, required_trades").eq("id", id).single(),
    supabase.from("takeoff_measurements").select("*").eq("project_id", id).eq("storage_path", path).order("created_at"),
  ]);

  if (!project) notFound();

  // Generate signed URL
  const storageBucket = bucket || "email-attachments";
  const { data: urlData } = await supabase.storage
    .from(storageBucket)
    .createSignedUrl(path, 7200);

  if (!urlData?.signedUrl) redirect(`/projects/${id}/estimates/drawings`);

  // Find extracted text for this PDF from inbox_emails attachments
  let drawingText = "";
  const { data: emails } = await supabase
    .from("inbox_emails")
    .select("attachments")
    .eq("project_id", id);

  for (const email of emails ?? []) {
    const atts = (email.attachments as { storage_path?: string; text_content?: string }[] | null) ?? [];
    const match = atts.find(a => a.storage_path === path && a.text_content);
    if (match?.text_content) {
      drawingText = match.text_content;
      break;
    }
  }

  // Also check project_files for extracted text/description
  if (!drawingText) {
    const { data: pf } = await supabase
      .from("project_files")
      .select("description")
      .eq("storage_path", path)
      .single();
    if (pf?.description) drawingText = pf.description;
  }

  return (
    <TakeoffPage
      projectId={id}
      projectName={project.name}
      pdfUrl={urlData.signedUrl}
      filename={filename || path.split("/").pop() || "Drawing"}
      storagePath={path}
      backHref={`/projects/${id}/estimates/drawings`}
      drawingText={drawingText}
      scopeOfWork={project.scope_of_work || ""}
      initialMeasurements={(measurements ?? [])
        .filter((m) => m.measurement_type !== "checklist")
        .map((m) => ({
          id: m.id,
          type: m.measurement_type as "linear" | "area" | "count",
          label: m.label,
          points: (m.points as { x: number; y: number }[]) || [],
          value: Number(m.value) || 0,
          unit: m.unit || "ft",
          color: m.color || "#F59E0B",
          pageNumber: m.page_number || 1,
        }))}
      initialChecklist={(measurements ?? [])
        .filter((m) => m.measurement_type === "checklist")
        .map((m) => {
          const meta = Array.isArray(m.points) && m.points.length > 0
            ? (m.points as unknown as { type: string; description: string; done: boolean }[])[0]
            : { type: "linear", description: "", done: false };
          return {
            label: m.label,
            type: (meta.type || "linear") as "linear" | "area" | "count",
            trade: m.trade || "",
            description: meta.description || "",
            done: Number(m.value) === 1,
          };
        })}
      scalePixelsPerFoot={
        measurements?.find((m) => m.scale_pixels_per_foot)
          ? Number(measurements.find((m) => m.scale_pixels_per_foot)!.scale_pixels_per_foot)
          : undefined
      }
    />
  );
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { projectId, storagePath, measurements, scalePixelsPerFoot } = await request.json();
  if (!projectId || !storagePath) {
    return NextResponse.json({ error: "Missing projectId or storagePath" }, { status: 400 });
  }

  // Delete existing measurements for this file
  await supabase
    .from("takeoff_measurements")
    .delete()
    .eq("project_id", projectId)
    .eq("storage_path", storagePath);

  // Insert new measurements
  if (measurements && measurements.length > 0) {
    const rows = measurements.map((m: {
      type: string;
      label: string;
      points: { x: number; y: number }[];
      value: number;
      unit: string;
      color: string;
      pageNumber: number;
    }) => ({
      project_id: projectId,
      storage_path: storagePath,
      page_number: m.pageNumber || 1,
      scale_pixels_per_foot: scalePixelsPerFoot || null,
      measurement_type: m.type,
      label: m.label,
      color: m.color || "#F59E0B",
      points: m.points,
      value: m.value,
      unit: m.unit,
      created_by: user.id,
    }));

    const { error } = await supabase.from("takeoff_measurements").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: measurements?.length || 0 });
}

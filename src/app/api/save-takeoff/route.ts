import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { projectId, storagePath, measurements, checklist, scalePixelsPerFoot } = await request.json();
    if (!projectId || !storagePath) {
      return NextResponse.json({ error: "Missing projectId or storagePath" }, { status: 400 });
    }

    // Delete existing measurements (NOT checklist) for this file
    await supabase
      .from("takeoff_measurements")
      .delete()
      .eq("project_id", projectId)
      .eq("storage_path", storagePath)
      .neq("measurement_type", "checklist");

    // Insert measurements
    if (measurements && measurements.length > 0) {
      const rows = measurements.map((m: {
        type: string; label: string; points: { x: number; y: number }[];
        value: number; unit: string; color: string; pageNumber: number;
      }) => {
        const val = Number(m.value);
        return {
          project_id: projectId,
          storage_path: storagePath,
          page_number: m.pageNumber || 1,
          scale_pixels_per_foot: scalePixelsPerFoot && !isNaN(Number(scalePixelsPerFoot)) ? Number(scalePixelsPerFoot) : null,
          measurement_type: m.type || "linear",
          label: m.label || m.type || "Measurement",
          color: m.color || "#F59E0B",
          points: m.points || [],
          value: isNaN(val) ? 0 : val,
          unit: m.unit || "ft",
          created_by: user.id,
        };
      });
      const { error } = await supabase.from("takeoff_measurements").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Save checklist if provided (replace existing)
    if (checklist && Array.isArray(checklist) && checklist.length > 0) {
      await supabase
        .from("takeoff_measurements")
        .delete()
        .eq("project_id", projectId)
        .eq("storage_path", storagePath)
        .eq("measurement_type", "checklist");

      const checklistRows = checklist.map((item: {
        label: string; type: string; trade: string; description: string; done: boolean;
      }) => ({
        project_id: projectId,
        storage_path: storagePath,
        measurement_type: "checklist",
        label: item.label,
        trade: item.trade || null,
        points: [{ type: item.type, description: item.description, done: item.done }],
        value: item.done ? 1 : 0,
        unit: item.type,
        created_by: user.id,
      }));

      await supabase.from("takeoff_measurements").insert(checklistRows);
    }

    return NextResponse.json({ success: true, count: measurements?.length || 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 500 });
  }
}

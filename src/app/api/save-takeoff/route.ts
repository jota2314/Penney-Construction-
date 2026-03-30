import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
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
      if (error) {
        console.error("Takeoff save error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, count: measurements?.length || 0 });
  } catch (err) {
    console.error("Takeoff save error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 500 });
  }
}

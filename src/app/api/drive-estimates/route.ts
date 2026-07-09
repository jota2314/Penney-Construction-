import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleFetch } from "@/lib/google/auth";
import { callClaude } from "@/lib/ai/claude";
import { lineItemFinancials } from "@/lib/estimates/line-item-financials";
import { spreadsheetBufferToCsv } from "@/lib/spreadsheets/to-csv";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const SHARED_DRIVE_ID = "0AE-3Z0cmiD5rUk9PVA";

/**
 * GET /api/drive-estimates — List estimate files from Google Drive
 * POST /api/drive-estimates — Import a specific file as an estimate
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    // Search for estimate/proposal spreadsheets in the shared drive
    const query = encodeURIComponent(
      "(mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType='application/vnd.ms-excel') and trashed=false"
    );

    const res = await googleFetch(
      `${DRIVE_API}/files?q=${query}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${SHARED_DRIVE_ID}&fields=files(id,name,mimeType,modifiedTime,size,parents)&orderBy=modifiedTime desc&pageSize=50`
    );

    if (!res.ok) {
      // Try without shared drive (personal drive)
      const res2 = await googleFetch(
        `${DRIVE_API}/files?q=${query}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=50`
      );
      if (!res2.ok) throw new Error("Failed to list Drive files");
      const data2 = await res2.json();
      return NextResponse.json({ files: data2.files || [] });
    }

    const data = await res.json();
    return NextResponse.json({ files: data.files || [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Drive access failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { fileId, projectId } = await request.json();
  if (!fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });

  try {
    // Get file metadata
    const metaRes = await googleFetch(
      `${DRIVE_API}/files/${fileId}?fields=name,mimeType&supportsAllDrives=true`
    );
    if (!metaRes.ok) throw new Error("Failed to get file metadata");
    const meta = await metaRes.json();

    // Export as CSV (works for both Google Sheets and uploaded Excel)
    let csvText = "";
    if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
      const exportRes = await googleFetch(
        `${DRIVE_API}/files/${fileId}/export?mimeType=text/csv`
      );
      if (!exportRes.ok) throw new Error("Failed to export spreadsheet");
      csvText = await exportRes.text();
    } else {
      // For uploaded Excel files, download and convert
      const dlRes = await googleFetch(
        `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`
      );
      if (!dlRes.ok) throw new Error("Failed to download file");
      const buffer = await dlRes.arrayBuffer();

      csvText = await spreadsheetBufferToCsv(buffer, meta.name, false);
    }

    if (!csvText) throw new Error("Empty file");

    // Get list of projects for matching
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name")
      .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"]);

    const projectList = (projects ?? []).map(p => `${p.id}: ${p.name}`).join("\n");

    // AI parses the CSV into estimate line items
    const parsePrompt = `Parse this construction estimate spreadsheet into line items.

FILE NAME: ${meta.name}
CSV DATA:
${csvText.substring(0, 8000)}

EXISTING PROJECTS (match by name):
${projectList}

Return a JSON object:
{
  "project_name": "Best matching project name from the list above",
  "project_id": "UUID of the matched project (or null if no match)",
  "line_items": [
    {
      "category": "Trade/phase name",
      "scope_text": "Scope description from the spreadsheet",
      "client_price": 5000,
      "quote_status": "known"
    }
  ]
}

RULES:
- Match the file name to a project (e.g., "Kline - 2 Bathrooms" → "Kline Bathroom")
- Extract EVERY line item with its category and price
- The price column is the CLIENT PRICE (what the customer sees)
- Back-calculate cost at 30% margin: cost = client_price / 1.30
- Skip total/subtotal rows
- Skip empty rows and header rows`;

    const aiResponse = await callClaude(
      "You parse construction estimate spreadsheets into structured data. Return ONLY JSON.",
      parsePrompt,
      4096
    );

    let result: Record<string, unknown> = {};
    try {
      const cleaned = aiResponse.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        result = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
      }
    } catch {
      return NextResponse.json({ error: "Failed to parse estimate" }, { status: 500 });
    }

    // Use provided projectId or AI-matched one
    const targetProjectId = projectId || (result.project_id as string) || null;
    const lineItems = (result.line_items as Record<string, unknown>[]) || [];

    if (lineItems.length === 0) {
      return NextResponse.json({ error: "No line items found in file" }, { status: 400 });
    }

    // Create estimate if we have a project
    if (targetProjectId) {
      const { data: estimate } = await supabase
        .from("estimates")
        .insert({
          project_id: targetProjectId,
          name: meta.name.replace(/\.(xlsx|xls|csv)$/i, ""),
          total_price: lineItems.reduce((s, l) => s + (Number(l.client_price) || 0), 0),
          total_cost: lineItems.reduce((s, l) => s + Math.round((Number(l.client_price) || 0) / 1.3), 0),
          markup_pct: 30,
          estimate_type: "preliminary",
          status: "draft",
          version: 1,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (estimate) {
        const items = lineItems.map((l, i) => {
          const price = Number(l.client_price) || 0;
          const cost = Math.round(price / 1.3);
          return {
            estimate_id: estimate.id,
            description: String(l.category || ""),
            scope_text: String(l.scope_text || ""),
            quantity: 1,
            unit_cost: cost,
            ...lineItemFinancials(cost, 30, price),
            quote_status: String(l.quote_status || "known"),
            sort_order: i,
          };
        });

        await supabase.from("estimate_line_items").insert(items);
      }

      return NextResponse.json({
        success: true,
        project_id: targetProjectId,
        project_name: result.project_name,
        file_name: meta.name,
        line_items: lineItems.length,
        total_price: lineItems.reduce((s, l) => s + (Number(l.client_price) || 0), 0),
      });
    }

    // No project match — return parsed data for manual assignment
    return NextResponse.json({
      success: true,
      project_id: null,
      project_name: result.project_name,
      file_name: meta.name,
      line_items: lineItems,
      total_price: lineItems.reduce((s, l) => s + (Number(l.client_price) || 0), 0),
      needs_project_assignment: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}

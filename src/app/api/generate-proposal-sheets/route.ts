import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleFetch } from "@/lib/google/auth";

export const runtime = "nodejs";

/**
 * Generate proposal Excel, upload to Google Drive as a Google Sheet,
 * and return the Sheets URL.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Generate the Excel buffer by calling our own endpoint internally
  const origin = request.nextUrl.origin;
  const excelRes = await fetch(`${origin}/api/generate-proposal?projectId=${projectId}`, {
    headers: { cookie: request.headers.get("cookie") || "" },
  });

  if (!excelRes.ok) {
    const err = await excelRes.json().catch(() => ({ error: "Failed to generate proposal" }));
    return NextResponse.json(err, { status: excelRes.status });
  }

  const excelBuffer = Buffer.from(await excelRes.arrayBuffer());
  const filename = excelRes.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] || "Proposal.xlsx";
  const sheetsName = filename.replace(".xlsx", "");

  // Look for project's Google Drive folder
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name, google_drive_folder_id")
    .eq("id", projectId)
    .single();

  // Upload to Google Drive with conversion to Google Sheets
  const SHARED_DRIVE_ID = "0AE-3Z0cmiD5rUk9PVA";
  const parentId = project?.google_drive_folder_id || SHARED_DRIVE_ID;

  const metadata = {
    name: sheetsName,
    mimeType: "application/vnd.google-apps.spreadsheet",
    parents: [parentId],
  };

  const boundary = `boundary_${Date.now()}`;
  const metaPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n`;

  const closePart = `\r\n--${boundary}--`;

  // Build multipart body with binary Excel content
  const metaBuffer = Buffer.from(metaPart, "utf-8");
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    "utf-8"
  );
  const closeBuffer = Buffer.from(closePart, "utf-8");
  const body = Buffer.concat([metaBuffer, fileHeader, excelBuffer, closeBuffer]);

  const uploadRes = await googleFetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return NextResponse.json({ error: `Drive upload failed: ${err}` }, { status: 500 });
  }

  const file = await uploadRes.json();

  return NextResponse.json({
    url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`,
    id: file.id,
    name: file.name,
  });
}

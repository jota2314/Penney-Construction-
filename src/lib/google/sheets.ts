/**
 * Google Sheets API integration.
 * Reads cell values from a spreadsheet (used to pull per-job ledgers
 * out of the Shared Drive). Auth + token refresh handled by googleFetch.
 */

import { googleFetch } from "./auth";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

/**
 * Read a sheet's cell values as a 2D array of strings.
 * If no range is given, reads the first tab in full.
 */
export async function readSheetValues(
  spreadsheetId: string,
  range?: string
): Promise<string[][]> {
  let useRange = range;

  if (!useRange) {
    const metaRes = await googleFetch(
      `${SHEETS_API}/${spreadsheetId}?fields=sheets(properties(title))`,
      { method: "GET" }
    );
    if (!metaRes.ok) {
      throw new Error(`Failed to read sheet metadata: ${await metaRes.text()}`);
    }
    const meta = await metaRes.json();
    const firstTitle: string | undefined =
      meta.sheets?.[0]?.properties?.title;
    useRange = firstTitle || "A:Z";
  }

  const res = await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(
      useRange
    )}?majorDimension=ROWS`,
    { method: "GET" }
  );
  if (!res.ok) {
    throw new Error(`Failed to read sheet values: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.values || []) as string[][];
}

export interface DriveSheetMatch {
  id: string;
  name: string;
  webViewLink: string;
  modifiedTime?: string;
}

/**
 * Find Google Sheets in the Shared Drive whose name contains `term`.
 * Used to auto-discover a job's ledger (e.g. "Gouthro Ledger").
 * Most-recently-modified first.
 */
export async function findSheetsByName(term: string): Promise<DriveSheetMatch[]> {
  const safe = term.replace(/'/g, "\\'");
  const q = `name contains '${safe}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const fields = "files(id,name,webViewLink,modifiedTime)";
  const res = await googleFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(
      fields
    )}&pageSize=10&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { method: "GET" }
  );
  if (!res.ok) {
    throw new Error(`Failed to search Drive sheets: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.files || []) as DriveSheetMatch[];
}

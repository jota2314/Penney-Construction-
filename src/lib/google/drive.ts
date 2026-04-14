/**
 * Google Drive API integration for Penney Construction workflow.
 * Creates project folders, subfolders, and documents in Shared Drive.
 */

import { googleFetch } from "./auth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const SHARED_DRIVE_ID = "0AE-3Z0cmiD5rUk9PVA";

export interface DriveFolder {
  id: string;
  name: string;
  webViewLink: string;
}

export interface ProjectFolderResult {
  folder: DriveFolder;
  subfolders: Record<string, DriveFolder>;
}

/**
 * Create a project folder in the Penney Construction Shared Drive.
 * Returns the main folder and all subfolder references.
 */
export async function createProjectFolder(
  projectName: string,
  clientName: string,
  parentFolderId?: string
): Promise<ProjectFolderResult> {
  const folderName = `${clientName} - ${projectName}`;

  // Create main project folder in Shared Drive
  const folder = await createFolder(folderName, parentFolderId || SHARED_DRIVE_ID);

  // Create standard subfolders
  const subfolderNames = [
    "01 - Lead Info",
    "02 - Walkthrough",
    "03 - Estimates",
    "04 - Proposals",
    "05 - Contracts",
    "06 - Job Package",
  ];

  const subfolderResults = await Promise.all(
    subfolderNames.map((name) => createFolder(name, folder.id))
  );

  const subfolders: Record<string, DriveFolder> = {};
  subfolderNames.forEach((name, i) => {
    subfolders[name] = subfolderResults[i];
  });

  return { folder, subfolders };
}

/**
 * Create a Google Doc with content in a specific folder.
 */
export async function createGoogleDoc(
  title: string,
  content: string,
  parentFolderId: string
): Promise<DriveFolder> {
  // Create the doc file via Drive API
  const metadata = {
    name: title,
    mimeType: "application/vnd.google-apps.document",
    parents: [parentFolderId],
  };

  const boundary = `boundary_${Date.now()}`;
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;

  // Convert content to simple HTML for Google Docs
  const htmlContent = contentToHtml(content);

  const multipartBody =
    `${delimiter}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `${delimiter}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    `${htmlContent}\r\n` +
    `${closeDelimiter}`;

  const res = await googleFetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Google Doc: ${err}`);
  }

  return res.json();
}

/**
 * Convert plain text content to HTML for Google Docs.
 */
function contentToHtml(content: string): string {
  const sections = content.split("\n\n");
  let html = "<html><body>";

  for (const section of sections) {
    if (section.startsWith("# ")) {
      html += `<h1>${section.slice(2)}</h1>`;
    } else if (section.startsWith("## ")) {
      html += `<h2>${section.slice(3)}</h2>`;
    } else if (section.startsWith("---")) {
      html += "<hr/>";
    } else {
      const lines = section.split("\n");
      for (const line of lines) {
        if (line.startsWith("- ")) {
          html += `<ul><li>${line.slice(2)}</li></ul>`;
        } else if (line.includes(": ")) {
          const [label, ...rest] = line.split(": ");
          html += `<p><strong>${label}:</strong> ${rest.join(": ")}</p>`;
        } else {
          html += `<p>${line}</p>`;
        }
      }
    }
  }

  html += "</body></html>";
  return html;
}

/**
 * Create a single folder in Google Drive.
 */
async function createFolder(
  name: string,
  parentId?: string
): Promise<DriveFolder> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };

  if (parentId) {
    metadata.parents = [parentId];
  }

  const res = await googleFetch(`${DRIVE_API}/files?fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: "POST",
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Drive folder: ${err}`);
  }

  return res.json();
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  size?: string;
  modifiedTime?: string;
}

/**
 * List files in a Google Drive folder (non-recursive).
 */
export async function listFolderFiles(
  folderId: string,
  pageSize = 50
): Promise<DriveFile[]> {
  const q = `'${folderId}' in parents and trashed = false`;
  const fields = "files(id,name,mimeType,webViewLink,iconLink,size,modifiedTime)";
  const res = await googleFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=${pageSize}&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { method: "GET" }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list Drive files: ${err}`);
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Share a Drive folder with a user (for client access if needed).
 */
export async function shareFolder(
  folderId: string,
  email: string,
  role: "reader" | "writer" = "reader"
): Promise<void> {
  const res = await googleFetch(
    `${DRIVE_API}/files/${folderId}/permissions?supportsAllDrives=true`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "user",
        role,
        emailAddress: email,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to share folder: ${err}`);
  }
}

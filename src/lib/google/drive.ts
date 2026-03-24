/**
 * Google Drive API integration for Penney Construction workflow.
 * Creates project folders and manages files.
 */

import { googleFetch } from "./auth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

interface DriveFolder {
  id: string;
  name: string;
  webViewLink: string;
}

/**
 * Create a project folder in Google Drive.
 * Creates a main folder and standard subfolders for the project.
 */
export async function createProjectFolder(
  projectName: string,
  clientName: string,
  parentFolderId?: string
): Promise<DriveFolder> {
  const folderName = `${clientName} - ${projectName}`;

  // Create main project folder
  const folder = await createFolder(folderName, parentFolderId);

  // Create standard subfolders
  const subfolders = [
    "01 - Lead Info",
    "02 - Walkthrough Photos",
    "03 - Estimates",
    "04 - Proposals",
    "05 - Contracts",
    "06 - Job Package",
    "07 - Change Orders",
    "08 - Invoices",
  ];

  await Promise.all(
    subfolders.map((name) => createFolder(name, folder.id))
  );

  return folder;
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

  const res = await googleFetch(`${DRIVE_API}/files?fields=id,name,webViewLink`, {
    method: "POST",
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Drive folder: ${err}`);
  }

  return res.json();
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
    `${DRIVE_API}/files/${folderId}/permissions`,
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

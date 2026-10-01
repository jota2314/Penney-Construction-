/**
 * How-To Guides (/guides) — shared by the page, the server actions and the
 * browser upload. Guides are PDFs in the private `how-to-guides` bucket; the
 * `how_to_guides` table holds the title, section and who made it.
 */

export const GUIDES_BUCKET = "how-to-guides";

/** Sections, in the order they show on the page. */
export const GUIDE_CATEGORIES = [
  "Email & Drawings",
  "Money",
  "Running a Job",
  "Forms",
  "Other",
] as const;

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

export function isGuideCategory(value: string): value is GuideCategory {
  return (GUIDE_CATEGORIES as readonly string[]).includes(value);
}

export interface HowToGuide {
  id: string;
  title: string;
  summary: string | null;
  category: string;
  author: string | null;
  file_path: string;
  file_name: string | null;
  file_size: number | null;
  sort_order: number;
  updated_at: string;
}

export interface HowToGuideWithUrl extends HowToGuide {
  /** Signed URL for the PDF; null when signing failed. */
  url: string | null;
}

/** Where a new upload goes. One fresh object per upload — a replace never overwrites. */
export function newGuideFilePath(): string {
  return `guides/${crypto.randomUUID()}.pdf`;
}

/** A path the browser uploaded, as newGuideFilePath() makes them. */
export function isGuideFilePath(path: string): boolean {
  return /^guides\/[0-9a-f-]{36}\.pdf$/i.test(path);
}

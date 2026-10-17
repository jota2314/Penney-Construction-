import type { ReactNode } from "react";
import { fmtDate } from "@/lib/portal-kit/format";

/**
 * Grouped document rows, copied from the client portal's Documents tab: a
 * 60px row with a type badge, the title, "subtitle · date" and ›. Every row
 * opens in a new tab, which hands iOS its own PDF viewer (pinch zoom that
 * actually works; the in-app viewers can't intercept it).
 */

/** One row. SubDocument (payload.ts) fits as-is. */
export interface DocumentListItem {
  id: string;
  title: string;
  subtitle?: string | null;
  /** A day or timestamp. */
  date?: string | null;
  url: string;
  mime?: string | null;
  /** Overrides the badge text worked out from mime / title. */
  badge?: string;
}

export interface DocumentListGroup {
  key: string;
  label: string;
  docs: DocumentListItem[];
}

/** "PDF", "IMG", "DOC" or "FILE" — a text badge, no icons. */
export function documentBadge(doc: Pick<DocumentListItem, "mime" | "title" | "url" | "badge">): string {
  if (doc.badge) return doc.badge;
  const mime = (doc.mime ?? "").toLowerCase();
  const name = `${doc.title} ${doc.url.split("?")[0]}`.toLowerCase();
  if (mime.includes("pdf") || /\.pdf\b/.test(name)) return "PDF";
  if (mime.startsWith("image/") || /\.(jpe?g|png|heic|webp|gif)\b/.test(name)) return "IMG";
  if (/word|excel|sheet|officedocument/.test(mime) || /\.(docx?|xlsx?)\b/.test(name)) return "DOC";
  return "FILE";
}

export function DocumentList({ groups, empty }: { groups: DocumentListGroup[]; empty?: ReactNode }) {
  const shown = groups.filter((g) => g.docs.length > 0);
  if (shown.length === 0) {
    return empty ? <>{empty}</> : null;
  }
  return (
    <>
      {shown.map((g) => (
        <section key={g.key}>
          <h3 className="px-1 pb-2 pt-1 text-[18px] font-extrabold">{g.label}</h3>
          <ul className="card divide-y divide-[var(--line)]">
            {g.docs.map((d) => (
              <li key={d.id}>
                <a href={d.url} target="_blank" rel="noreferrer" className="flex min-h-[60px] items-center gap-3 px-4 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--paper)] text-[12px] font-extrabold text-[var(--accent-dark)]">
                    {documentBadge(d)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-bold leading-snug">{d.title}</span>
                    <span className="block text-[14px] text-[var(--muted)]">
                      {[d.subtitle, d.date ? fmtDate(d.date, "") : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 text-[22px] text-[var(--muted)]">›</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

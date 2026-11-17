import { ArrowUpRight, FileText, FolderOpen } from "lucide-react";
import { documentBadge } from "@/components/portal-kit/document-list";
import { Empty } from "@/components/portal-kit/empty";
import { fmtDate } from "@/lib/portal-kit/format";
import type { SubDocument, SubDocumentGroup } from "@/lib/sub-portal/payload";

export function FieldDocumentLink({ document: doc, featured = false }: { document: SubDocument; featured?: boolean }) {
  const format = documentBadge(doc);
  return (
    <a href={doc.url} target="_blank" rel="noreferrer" className={`group flex min-h-[72px] items-start gap-3.5 py-4 sm:gap-4 ${featured ? "px-5 pb-6 text-white sm:px-6" : "px-4 text-[var(--ink)] hover:bg-[var(--paper)] sm:px-5"}`}>
      <span aria-hidden className={`flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg border ${featured ? "h-16 w-12 border-white/20 bg-white/10 text-white" : "h-12 w-10 border-[var(--line)] bg-[var(--paper)] text-[var(--accent-dark)]"}`}>
        <FileText size={featured ? 23 : 18} strokeWidth={1.5} />
        <span className="text-[10px] font-extrabold leading-none tracking-wide">{format}</span>
      </span>
      <span className="min-w-0 flex-1">
        {featured && <span className="mb-1 block text-[13px] font-bold text-[#EBC3A9]">{doc.group === "drawings" ? "Current drawing" : "Job file"}</span>}
        <span className={`block font-bold leading-snug tracking-tight group-hover:underline group-hover:underline-offset-4 ${featured ? "text-[18px] sm:text-[20px]" : "text-[16px]"}`}>{doc.title}</span>
        {(doc.subtitle || doc.date) && (
          <span className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold ${featured ? "text-white/85" : "text-[var(--muted)]"}`}>
            {doc.subtitle && <span className={`rounded px-1.5 py-0.5 ${featured ? "bg-white/15 text-white" : "bg-[var(--paper)]"}`}>{doc.subtitle}</span>}
            {doc.date && <span>{fmtDate(doc.date)}</span>}
          </span>
        )}
      </span>
      <ArrowUpRight aria-hidden size={17} className={`mt-0.5 shrink-0 ${featured ? "text-white/80" : "text-[var(--accent-dark)]"}`} />
    </a>
  );
}

/**
 * A job's Drawings tab: the files the server already passed through the one
 * crew/sub filter (fieldVisibleFiles, SUB_FILE_CATEGORIES, latest revision
 * only), grouped Drawings / Specs / Permits / Design & selections. No second
 * filter here. Each 60px row opens in a new tab, which gives iOS its own PDF
 * viewer with pinch zoom.
 */
export function JobDrawings({ files, unavailable, onRetry }: { files: SubDocumentGroup[]; unavailable: boolean; onRetry: () => void }) {
  return (
    <div className="space-y-5">
      <h2 className="text-[27px] font-extrabold tracking-[-0.04em] sm:text-[32px]">Plans &amp; files</h2>
      {unavailable && (
        <Empty action={<button type="button" className="btn btn-ghost" onClick={onRetry}>Try again</button>}>
          {files.length ? "Some job files couldn’t load." : "We couldn’t load the current job files."}
        </Empty>
      )}
      {files.length === 0 && !unavailable && <Empty>Penney hasn’t posted plans or files for this job yet.</Empty>}
      <div className="grid gap-5 md:grid-cols-2 xl:gap-7">
        {files.filter((group) => group.docs.length > 0).map((group) => (
          <section key={group.key} className="min-w-0 self-start overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
            <h3 className="flex items-center gap-2.5 border-b border-[var(--line)] bg-[var(--paper)]/65 px-4 py-3.5 text-[18px] font-extrabold tracking-tight sm:px-5">
              <FolderOpen aria-hidden size={18} className="text-[var(--accent-dark)]" />{group.label}
              <span className="ml-auto text-[13px] font-bold text-[var(--muted)]">{group.docs.length} {group.docs.length === 1 ? "file" : "files"}</span>
            </h3>
            <ul className="divide-y divide-[var(--line)]">
              {group.docs.map((doc) => <li key={doc.id}><FieldDocumentLink document={doc} /></li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

import { DocumentList } from "@/components/portal-kit/document-list";
import { Empty } from "@/components/portal-kit/empty";
import type { SubDocumentGroup } from "@/lib/sub-portal/payload";

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
      {unavailable && (
        <Empty action={<button type="button" className="btn btn-ghost" onClick={onRetry}>Try again</button>}>
          {files.length ? "Some job files couldn’t load." : "We couldn’t load the current job files."}
        </Empty>
      )}
      <DocumentList groups={files} empty={unavailable ? null : <Empty>Penney hasn’t posted plans or files for this job yet.</Empty>} />
    </div>
  );
}

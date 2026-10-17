import { DocumentList, Empty } from "@/components/portal-kit";
import type { SubDocumentGroup } from "@/lib/sub-portal/payload";

/**
 * A job's Drawings tab: the files the server already passed through the one
 * crew/sub filter (fieldVisibleFiles, SUB_FILE_CATEGORIES, latest revision
 * only), grouped Drawings / Specs / Permits / Design & selections. No second
 * filter here. Each 60px row opens in a new tab, which gives iOS its own PDF
 * viewer with pinch zoom.
 */
export function JobDrawings({ files }: { files: SubDocumentGroup[] }) {
  return (
    <div className="space-y-5">
      <DocumentList groups={files} empty={<Empty>No drawings posted for this job yet.</Empty>} />
    </div>
  );
}

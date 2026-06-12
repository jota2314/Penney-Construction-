"use client";

import { useEffect, useState, useTransition } from "react";
import { v } from "./tokens";
import { getCrewJobDocuments, type CrewDoc } from "@/lib/actions/project-files";

const CATEGORY_LABEL: Record<string, string> = {
  construction_drawings: "Drawings",
  plans: "Plans",
  permits: "Permits",
  specs: "Specs",
  other: "Other",
};
const CATEGORY_ORDER = ["construction_drawings", "plans", "permits", "specs", "other"];

function FileIcon({ mime }: { mime: string | null }) {
  const isImg = !!mime && mime.startsWith("image/");
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5 flex-shrink-0" style={{ color: v("accent") }}>
      {isImg ? (
        <>
          <rect x="3" y="4" width="14" height="12" rx="1.5" />
          <circle cx="8" cy="9" r="1.5" />
          <path d="M4 15l4-4 3 3 3-3 2 2" />
        </>
      ) : (
        <>
          <path d="M5 3h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M12 3v4h4" />
        </>
      )}
    </svg>
  );
}

export function JobDocsSheet({
  projectId,
  jobName,
  onClose,
}: {
  projectId: string;
  jobName: string;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<CrewDoc[]>([]);
  const [loading, startLoad] = useTransition();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    startLoad(async () => {
      const rows = await getCrewJobDocuments(projectId);
      setDocs(rows);
      setLoaded(true);
    });
  }, [projectId]);

  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABEL[cat] ?? cat,
    items: docs.filter((d) => d.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92vh] overflow-hidden"
        style={{ background: v("card"), border: `1px solid ${v("line")}`, color: v("ink") }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${v("line")}` }}>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
              Plans &amp; documents
            </div>
            <div className="text-[15px] font-semibold leading-tight mt-0.5 truncate" style={{ color: v("ink") }}>
              {jobName}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100 flex-shrink-0 ml-3" style={{ color: v("ink") }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3 flex flex-col gap-3">
          {loading || !loaded ? (
            <div className="px-2 py-8 text-center text-[13px]" style={{ color: v("muted") }}>Loading documents…</div>
          ) : groups.length === 0 ? (
            <div className="px-2 py-8 text-center text-[13px]" style={{ color: v("muted") }}>
              No drawings or documents on this job yet.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.cat} className="flex flex-col gap-1">
                <div className="px-2 text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: v("quiet") }}>
                  {g.label}
                </div>
                {g.items.map((d) => (
                  <a
                    key={d.id}
                    href={d.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`rounded-lg px-3 py-2.5 flex items-center gap-3 transition active:scale-[0.99] ${d.url ? "" : "opacity-50 pointer-events-none"}`}
                    style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                  >
                    <FileIcon mime={d.mime_type} />
                    <span className="text-[14px] leading-snug min-w-0 flex-1 truncate" style={{ color: v("ink") }}>
                      {d.filename}
                    </span>
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4 flex-shrink-0" style={{ color: v("quiet") }}>
                      <path d="M7 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

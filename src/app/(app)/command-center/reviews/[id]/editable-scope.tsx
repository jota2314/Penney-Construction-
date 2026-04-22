"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { patchProjectScope } from "./actions";

export function EditableProjectScope({
  estimateId,
  projectId,
  initialScope,
  editable,
}: {
  estimateId: string;
  projectId: string;
  initialScope: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialScope);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startSaving(async () => {
      const res = await patchProjectScope(estimateId, projectId, draft);
      if (res.error) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  return (
    <details className="mt-4 pt-4 border-t border-border group" open={editing}>
      <summary className="flex items-center justify-between cursor-pointer list-none">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Scope of work
        </div>
        <div className="flex items-center gap-3">
          {editable && !editing && (
            <button
              onClick={(e) => { e.preventDefault(); setEditing(true); }}
              className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
            >
              <Pencil className="h-2.5 w-2.5" /> Edit
            </button>
          )}
          <div className="text-[11px] text-muted-foreground font-medium group-open:hidden">Show</div>
          <div className="text-[11px] text-muted-foreground font-medium hidden group-open:block">Hide</div>
        </div>
      </summary>
      {editing ? (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-[180px] text-[13px] leading-relaxed bg-background border border-amber-500/50 rounded p-3 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            disabled={saving}
          />
          {error && <div className="text-[11px] text-red-500 mt-1.5">{error}</div>}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="text-[11px] px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-white font-semibold"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(initialScope); setError(null); }}
              disabled={saving}
              className="text-[11px] px-3 py-1.5 rounded bg-muted hover:bg-muted/70 font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90 mt-2">
          {initialScope || <span className="italic text-muted-foreground">No scope yet.</span>}
        </div>
      )}
    </details>
  );
}

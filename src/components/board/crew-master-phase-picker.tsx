"use client";

import { useEffect, useId, useState } from "react";
import { getProjectMasterPhaseOptions } from "@/lib/actions/crew-board";

/** Optional at dispatch: office can verify and link the report in Schedule later. */
export function CrewMasterPhasePicker({ projectId, value, onChange, compact = false }: {
  projectId: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  compact?: boolean;
}) {
  const id = useId();
  const [loaded, setLoaded] = useState<{ projectId: string; options: { id: string; name: string; status: string }[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void getProjectMasterPhaseOptions(projectId).then(result => {
      if (active) setLoaded({ projectId, ...result });
    }).catch(() => {
      if (active) setLoaded({ projectId, options: [], error: "Couldn't load schedule tasks. You can link later in Schedule review." });
    });
    return () => { active = false; };
  }, [projectId]);
  if (!projectId) return null;
  const current = loaded?.projectId === projectId ? loaded : null;
  return <div className={compact ? "w-64 space-y-1" : "space-y-1.5"}>
    <label htmlFor={id} className="text-xs font-medium text-muted-foreground">Master schedule task (optional)</label>
    <select id={id} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={value ?? ""}
      onChange={event => onChange(event.target.value || null)} disabled={!current || !!current.error}>
      <option value="">Link later in Schedule review</option>
      {value && !current?.options.some(option => option.id === value) && <option value={value}>Current linked task</option>}
      {current?.options.map(option => <option key={option.id} value={option.id}>{option.name} · {option.status.replaceAll("_", " ")} · {option.id.slice(0, 8)}</option>)}
    </select>
    {!current && <p className="text-xs text-muted-foreground">Loading schedule tasks…</p>}
    {current?.error && <p role="alert" className="text-xs text-destructive">{current.error}</p>}
  </div>;
}

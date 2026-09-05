"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignProjectManager } from "@/lib/actions/project-manager";
import { canBeProjectManager } from "@/lib/auth/team-access";

export function ProjectManagerPicker({ projectId, assignedPm, members, canEdit }: {
  projectId: string;
  assignedPm: string | null;
  members: { id: string; full_name: string | null; email: string; role: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = members.find((member) => member.id === assignedPm);
  if (!canEdit) return <p className="text-xs text-muted-foreground">Project manager: {current?.full_name || current?.email || "Unassigned"}</p>;
  return <div className="mt-2 max-w-sm">
    <label htmlFor={`pm-${projectId}`} className="text-xs font-medium text-muted-foreground">Project manager</label>
    <select id={`pm-${projectId}`} value={assignedPm || ""} disabled={pending}
      className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
      onChange={(event) => {
        const next = event.target.value || null;
        setError(null);
        startTransition(async () => {
          try {
            const result = await assignProjectManager(projectId, next);
            if (result.error) setError(result.error);
            else router.refresh();
          } catch { setError("Could not save the assignment. Please try again."); }
        });
      }}>
      <option value="">Unassigned</option>
      {members.filter((member) => canBeProjectManager(member.role) || member.id === assignedPm).map((member) =>
        <option key={member.id} value={member.id}>{member.full_name || member.email}</option>)}
    </select>
    <p aria-live="polite" className="mt-1 text-xs text-muted-foreground">{pending ? "Saving assignment…" : "Responsible for this job. Access is controlled by their team role."}</p>
    {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
  </div>;
}

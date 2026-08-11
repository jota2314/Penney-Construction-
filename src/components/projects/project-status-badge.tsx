"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
} from "@/lib/constants/project";
import type { ProjectStatus } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const ALL_STATUSES: ProjectStatus[] = [
  "lead",
  "estimating",
  "proposal_sent",
  "contracted",
  "in_progress",
  "audit",
  "completed",
  "cancelled",
];

interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  projectId?: string;
  editable?: boolean;
}

export function ProjectStatusBadge({ status, projectId, editable }: ProjectStatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(status);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  if (!editable || !projectId) {
    return (
      <Badge variant="secondary" className={PROJECT_STATUS_COLORS[status]}>
        {PROJECT_STATUS_LABELS[status]}
      </Badge>
    );
  }

  async function handleChange(newStatus: ProjectStatus) {
    if (newStatus === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", projectId);

    if (!error) {
      setCurrent(newStatus);
      router.refresh();
    }
    setSaving(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Badge
        variant="secondary"
        className={`${PROJECT_STATUS_COLORS[current]} cursor-pointer hover:opacity-80 transition-opacity ${saving ? "opacity-50" : ""}`}
        onClick={() => setOpen(!open)}
      >
        {PROJECT_STATUS_LABELS[current]} ▾
      </Badge>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 bg-card border rounded-lg shadow-xl py-1 min-w-[160px]">
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => handleChange(s)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2 ${
                  s === current ? "font-bold" : ""
                }`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${PROJECT_STATUS_COLORS[s].split(" ")[0]}`} />
                {PROJECT_STATUS_LABELS[s]}
                {s === current && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

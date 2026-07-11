"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProjectMeeting } from "@/lib/actions/project-meetings";
import { Mic, Loader2 } from "lucide-react";

interface ProjectOption {
  id: string;
  name: string;
  project_number: string | null;
}

export function NewMeetingForm({
  projects,
  preselectedProjectId,
}: {
  projects: ProjectOption[];
  preselectedProjectId?: string;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(
    preselectedProjectId &&
      projects.some((p) => p.id === preselectedProjectId)
      ? preselectedProjectId
      : ""
  );
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    if (!projectId) {
      setError("Pick a project first.");
      return;
    }
    setStarting(true);
    setError(null);
    const result = await createProjectMeeting(projectId, title || undefined);
    if (result.error || !result.id) {
      setError(result.error ?? "Could not start the meeting");
      setStarting(false);
      return;
    }
    router.push(`/meetings/${result.id}`);
  }

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-1.5">
        <Label>Project</Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger>
            <SelectValue placeholder="Which job is this meeting for?" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.project_number ? ` (${p.project_number})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Title (optional)</Label>
        <Input
          placeholder="e.g. Kitchen finishes walkthrough with client"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        className="w-full"
        size="lg"
        disabled={starting || !projectId}
        onClick={handleStart}
      >
        {starting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Mic className="mr-2 h-4 w-4" />
        )}
        Start meeting
      </Button>
    </div>
  );
}

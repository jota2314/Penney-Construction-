"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { createSiteVisit } from "@/lib/actions/site-visits";
import type { Project } from "@/types/database";

interface SiteVisitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Pick<Project, "id" | "project_number" | "name" | "status">[];
}

export function SiteVisitFormDialog({
  open,
  onOpenChange,
  projects,
}: SiteVisitFormDialogProps) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show all non-cancelled/completed projects
  const activeProjects = projects;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!projectId) {
      setError("Please select a project.");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await createSiteVisit({
      project_id: projectId,
      purpose: purpose || undefined,
    });

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      setProjectId("");
      setPurpose("");
      router.push(`/site-visits/${result.id}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Site Visit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="project" className="min-h-[44px]">
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                {activeProjects.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No active projects
                  </SelectItem>
                ) : (
                  activeProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.project_number} — {project.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="purpose">Purpose (optional)</Label>
            <Input
              id="purpose"
              placeholder="e.g. Framing inspection, Rough-in walk"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !projectId}>
              {loading ? "Starting..." : "Start Visit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

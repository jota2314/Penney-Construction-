"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createEstimate,
  createEstimateFromTemplate,
  updateEstimate,
} from "@/lib/actions/estimates";
import {
  ALL_ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
  ESTIMATE_TEMPLATES,
  TEMPLATE_LABELS,
} from "@/lib/constants/estimate";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { Estimate, EstimateStatus, ProjectType } from "@/types/database";

interface EstimateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  estimate?: Estimate | null;
  projectType?: ProjectType;
}

export function EstimateFormDialog({
  open,
  onOpenChange,
  projectId,
  estimate,
  projectType,
}: EstimateFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EstimateStatus>(
    estimate?.status ?? "draft"
  );
  const [template, setTemplate] = useState<string>("blank");
  const isEditing = !!estimate;

  // Build template options based on project type
  const templateOptions: { value: string; label: string }[] = [
    { value: "blank", label: "Blank Estimate" },
  ];

  if (!isEditing) {
    // Add matching project-type template first
    if (projectType && ESTIMATE_TEMPLATES[projectType]) {
      const label = PROJECT_TYPE_LABELS[projectType];
      templateOptions.push({
        value: projectType,
        label: `${label} Template`,
      });
    }

    // Add all other templates
    for (const [key, items] of Object.entries(ESTIMATE_TEMPLATES)) {
      if (key === projectType || !items || items.length === 0) continue;
      const label =
        PROJECT_TYPE_LABELS[key as ProjectType] ?? TEMPLATE_LABELS[key] ?? key;
      templateOptions.push({
        value: key,
        label: `${label} Template`,
      });
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const input = {
      name: form.get("name") as string,
      status,
      notes: form.get("notes") as string,
    };

    let result;

    if (isEditing) {
      result = await updateEstimate(estimate.id, projectId, input);
    } else if (template !== "blank") {
      result = await createEstimateFromTemplate(projectId, input, template);
    } else {
      result = await createEstimate(projectId, input);
    }

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setTemplate("blank");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Estimate" : "New Estimate"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Estimate Name *</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={estimate?.name ?? ""}
              placeholder="e.g. Kitchen Remodel v1"
            />
          </div>

          {!isEditing && templateOptions.length > 1 && (
            <div className="grid gap-2">
              <Label>Start from Template</Label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as EstimateStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_ESTIMATE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ESTIMATE_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={estimate?.notes ?? ""}
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
            <Button type="submit" disabled={loading}>
              {loading
                ? "Saving..."
                : isEditing
                  ? "Save Changes"
                  : "Create Estimate"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

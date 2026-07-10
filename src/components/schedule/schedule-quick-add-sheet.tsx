"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSchedulePhase } from "@/lib/actions/schedule";
import { DEFAULT_PHASE_NAMES } from "@/lib/constants/schedule";
import {
  ProjectPicker,
  type ScheduleProjectOption,
} from "./project-picker";

interface ScheduleQuickAddSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ScheduleProjectOption[];
  initialProjectId?: string;
  defaultDate: string;
  onCreated: (projectId: string, date: string) => void;
}

const QUICK_PHASES = DEFAULT_PHASE_NAMES.slice(0, 4);

export function ScheduleQuickAddSheet({
  open,
  onOpenChange,
  projects,
  initialProjectId,
  defaultDate,
  onCreated,
}: ScheduleQuickAddSheetProps) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectId(initialProjectId ?? "");
    setName("");
    setStartDate(defaultDate);
    setEndDate(defaultDate);
    setError(null);
  }, [open, initialProjectId, defaultDate]);

  function changeStartDate(nextDate: string) {
    const endFollowedStart = endDate === startDate;
    setStartDate(nextDate);
    if (endFollowedStart || endDate < nextDate) setEndDate(nextDate);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) {
      setError("Choose a project.");
      return;
    }
    if (endDate < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }

    setSaving(true);
    setError(null);
    const result = await createSchedulePhase({
      project_id: projectId,
      name,
      start_date: startDate,
      end_date: endDate,
    });
    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    onCreated(projectId, startDate);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="max-h-[85vh]"
      >
        <BottomSheetHeader>
          <BottomSheetTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-amber-500" />
            Add to schedule
          </BottomSheetTitle>
          <BottomSheetDescription>
            Quickly add a project phase. You can add crew and details later.
          </BottomSheetDescription>
        </BottomSheetHeader>

        <BottomSheetBody>
          <form
            id="schedule-quick-add-form"
            onSubmit={handleSubmit}
            className="space-y-5"
          >
            <div className="space-y-2">
              <Label>Project *</Label>
              <ProjectPicker
                projects={projects}
                value={projectId}
                onValueChange={setProjectId}
                placeholder="Search for a project..."
                className="h-11 w-full"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-phase-name">Schedule item *</Label>
              <Input
                id="quick-phase-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Framing, inspection, walkthrough"
                maxLength={120}
                required
                className="h-11"
              />
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PHASES.map((phaseName) => (
                  <button
                    key={phaseName}
                    type="button"
                    onClick={() => setName(phaseName)}
                    className="rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-amber-500/50 hover:text-foreground"
                  >
                    {phaseName}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="quick-start-date">Starts *</Label>
                <Input
                  id="quick-start-date"
                  type="date"
                  value={startDate}
                  onChange={(event) => changeStartDate(event.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="quick-end-date">Ends *</Label>
                <Input
                  id="quick-end-date"
                  type="date"
                  min={startDate}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  required
                  className="h-11"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        </BottomSheetBody>

        <BottomSheetFooter className="flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="schedule-quick-add-form"
            disabled={saving}
            className="flex-1 bg-amber-600 hover:bg-amber-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Adding..." : "Add schedule"}
          </Button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  );
}

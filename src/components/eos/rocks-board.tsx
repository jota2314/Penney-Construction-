"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ROCK_STATUS_CLASSES,
  ROCK_STATUS_LABELS,
} from "@/lib/constants/eos";
import {
  addMilestone,
  createRock,
  deleteMilestone,
  deleteRock,
  setRockStatus,
  toggleMilestone,
  updateRock,
} from "@/lib/actions/eos-rocks";
import type { EosPerson, EosRock, EosRockStatus } from "@/types/eos";
import { cn } from "@/lib/utils";

const STATUSES: EosRockStatus[] = ["on_track", "off_track", "complete", "incomplete"];
const UNASSIGNED = "unassigned";

export function RocksBoard({
  rocks,
  people,
  quarter,
  quarters,
}: {
  rocks: EosRock[];
  people: EosPerson[];
  quarter: string;
  quarters: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EosRock | null>(null);
  const [creating, setCreating] = useState(false);

  const company = rocks.filter((r) => r.type === "company");
  const individual = rocks.filter((r) => r.type === "individual");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="quarter" className="text-sm text-muted-foreground">
            Quarter
          </Label>
          <Select
            value={quarter}
            onValueChange={(value) => router.push(`/eos/rocks?quarter=${encodeURIComponent(value)}`)}
          >
            <SelectTrigger id="quarter" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quarters.map((q) => (
                <SelectItem key={q} value={q}>
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Rock
        </Button>
      </div>

      {rocks.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No Rocks for {quarter} yet.
          </CardContent>
        </Card>
      )}

      {company.length > 0 && (
        <Section title="Company Rocks">
          {company.map((rock) => (
            <RockRow
              key={rock.id}
              rock={rock}
              onEdit={() => setEditing(rock)}
            />
          ))}
        </Section>
      )}

      {individual.length > 0 && (
        <Section title="Individual Rocks">
          {individual.map((rock) => (
            <RockRow
              key={rock.id}
              rock={rock}
              onEdit={() => setEditing(rock)}
            />
          ))}
        </Section>
      )}

      {(creating || editing) && (
        <RockDialog
          rock={editing}
          people={people}
          quarter={quarter}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function RockRow({ rock, onEdit }: { rock: EosRock; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newMilestone, setNewMilestone] = useState("");

  const done = rock.milestones.filter((m) => m.isDone).length;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? "Hide milestones" : "Show milestones"}
            className="mt-0.5 text-muted-foreground hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{rock.title}</p>
            <p className="text-xs text-muted-foreground">
              {rock.ownerName ?? "Unassigned"}
              {rock.dueDate ? ` · due ${rock.dueDate}` : ""}
              {rock.milestones.length
                ? ` · ${done}/${rock.milestones.length} milestones`
                : ""}
            </p>
          </div>

          <Select
            value={rock.status}
            onValueChange={(value) =>
              startTransition(async () => {
                await setRockStatus(rock.id, value as EosRockStatus);
              })
            }
          >
            <SelectTrigger
              className={cn(
                "h-7 w-[122px] shrink-0 border text-xs",
                ROCK_STATUS_CLASSES[rock.status],
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status} className="text-xs">
                  {ROCK_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            <span className="sr-only">Edit Rock</span>
          </Button>
        </div>

        {open && (
          <div className="mt-3 space-y-2 border-t pt-3 pl-6">
            {rock.description && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {rock.description}
              </p>
            )}

            {rock.milestones.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <Checkbox
                  id={`ms-${m.id}`}
                  checked={m.isDone}
                  onCheckedChange={(checked) =>
                    startTransition(async () => {
                      await toggleMilestone(m.id, checked === true);
                    })
                  }
                />
                <label
                  htmlFor={`ms-${m.id}`}
                  className={cn(
                    "flex-1 text-sm",
                    m.isDone && "text-muted-foreground line-through",
                  )}
                >
                  {m.title}
                  {m.dueDate && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {m.dueDate}
                    </span>
                  )}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteMilestone(m.id);
                    })
                  }
                >
                  <Trash2 className="h-3 w-3" />
                  <span className="sr-only">Delete milestone</span>
                </Button>
              </div>
            ))}

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const title = newMilestone.trim();
                if (!title) return;
                setNewMilestone("");
                startTransition(async () => {
                  await addMilestone(rock.id, title);
                });
              }}
            >
              <Input
                value={newMilestone}
                onChange={(e) => setNewMilestone(e.target.value)}
                placeholder="Add a milestone…"
                className="h-8 text-sm"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RockDialog({
  rock,
  people,
  quarter,
  onClose,
}: {
  rock: EosRock | null;
  people: EosPerson[];
  quarter: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(rock?.title ?? "");
  const [description, setDescription] = useState(rock?.description ?? "");
  const [ownerId, setOwnerId] = useState(rock?.ownerId ?? UNASSIGNED);
  const [type, setType] = useState<EosRock["type"]>(rock?.type ?? "company");
  const [dueDate, setDueDate] = useState(rock?.dueDate ?? "");
  const [status, setStatus] = useState<EosRockStatus>(rock?.status ?? "on_track");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const payload = {
      title,
      description: description || null,
      ownerProfileId: ownerId === UNASSIGNED ? null : ownerId,
      type,
      quarter,
      dueDate: dueDate || null,
      status,
    };

    startTransition(async () => {
      const result = rock
        ? await updateRock({ ...payload, id: rock.id })
        : await createRock(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rock ? "Edit Rock" : `Add Rock — ${quarter}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rock-title">
              Title — make it SMART (specific, measurable, attainable, realistic, timely)
            </Label>
            <Input
              id="rock-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Hire and onboard a second PM by 9/30"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rock-desc">Detail</Label>
            <Textarea
              id="rock-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rock-owner">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="rock-owner">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rock-type">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as EosRock["type"])}
              >
                <SelectTrigger id="rock-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Company Rock</SelectItem>
                  <SelectItem value="individual">Individual Rock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rock-due">Due date</Label>
              <Input
                id="rock-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rock-status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as EosRockStatus)}
              >
                <SelectTrigger id="rock-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {ROCK_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {rock ? (
            <Button
              variant="ghost"
              className="text-red-500 hover:text-red-500"
              onClick={() =>
                startTransition(async () => {
                  await deleteRock(rock.id);
                  onClose();
                })
              }
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {rock ? "Save" : "Add Rock"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

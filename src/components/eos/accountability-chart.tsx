"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { createSeat, deleteSeat, updateSeat } from "@/lib/actions/eos-vto";
import type { EosPerson, EosSeat } from "@/types/eos";

const NONE = "none";

export function AccountabilityChart({
  seats,
  people,
}: {
  seats: EosSeat[];
  people: EosPerson[];
}) {
  const [editing, setEditing] = useState<EosSeat | null>(null);
  const [creating, setCreating] = useState(false);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, EosSeat[]>();
    for (const seat of seats) {
      const key = seat.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(seat);
    }
    // Orphans (parent deleted out from under them) still need to render.
    const ids = new Set(seats.map((s) => s.id));
    const roots = [
      ...(map.get(null) ?? []),
      ...seats.filter((s) => s.parentId && !ids.has(s.parentId)),
    ];
    map.set(null, roots);
    return map;
  }, [seats]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Right people, right seats. Every seat gets one name and up to five
          roles — if a seat needs two names, it is two seats.
        </p>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add seat
        </Button>
      </div>

      {seats.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No seats yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(childrenOf.get(null) ?? []).map((seat) => (
            <SeatNode
              key={seat.id}
              seat={seat}
              childrenOf={childrenOf}
              depth={0}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <SeatDialog
          seat={editing}
          seats={seats}
          people={people}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function SeatNode({
  seat,
  childrenOf,
  depth,
  onEdit,
}: {
  seat: EosSeat;
  childrenOf: Map<string | null, EosSeat[]>;
  depth: number;
  onEdit: (seat: EosSeat) => void;
}) {
  const children = childrenOf.get(seat.id) ?? [];

  return (
    <div style={{ marginLeft: depth ? 20 : 0 }}>
      <Card className={depth ? "border-l-2 border-l-amber-500/30" : undefined}>
        <CardContent className="flex items-start gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{seat.name}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              {seat.holderName ?? "Open seat"}
            </p>
            {seat.roles.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {seat.roles.map((role, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    • {role}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={() => onEdit(seat)}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="sr-only">Edit {seat.name}</span>
          </Button>
        </CardContent>
      </Card>

      {children.length > 0 && (
        <div className="mt-2 space-y-2">
          {children.map((child) => (
            <SeatNode
              key={child.id}
              seat={child}
              childrenOf={childrenOf}
              depth={depth + 1}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SeatDialog({
  seat,
  seats,
  people,
  onClose,
}: {
  seat: EosSeat | null;
  seats: EosSeat[];
  people: EosPerson[];
  onClose: () => void;
}) {
  const [name, setName] = useState(seat?.name ?? "");
  const [parentId, setParentId] = useState(seat?.parentId ?? NONE);
  const [holderId, setHolderId] = useState(seat?.holderProfileId ?? NONE);
  const [holderName, setHolderName] = useState(
    seat?.holderProfileId ? "" : (seat?.holderName ?? ""),
  );
  const [rolesText, setRolesText] = useState((seat?.roles ?? []).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Can't report to yourself or to your own descendant.
  const invalidParents = useMemo(() => {
    if (!seat) return new Set<string>();
    const blocked = new Set<string>([seat.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of seats) {
        if (s.parentId && blocked.has(s.parentId) && !blocked.has(s.id)) {
          blocked.add(s.id);
          grew = true;
        }
      }
    }
    return blocked;
  }, [seat, seats]);

  function submit() {
    setError(null);
    const roles = rolesText
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);

    const payload = {
      name,
      parentId: parentId === NONE ? null : parentId,
      holderProfileId: holderId === NONE ? null : holderId,
      holderName: holderId === NONE ? holderName || null : null,
      roles,
    };

    startTransition(async () => {
      const result = seat
        ? await updateSeat({ ...payload, id: seat.id })
        : await createSeat(payload);
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
          <DialogTitle>{seat ? "Edit seat" : "Add seat"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="seat-name">Seat name</Label>
            <Input
              id="seat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Operations"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seat-parent">Reports to</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="seat-parent">
                <SelectValue placeholder="Top of the chart" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Top of the chart</SelectItem>
                {seats
                  .filter((s) => !invalidParents.has(s.id))
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seat-holder">Who sits here</Label>
            <Select value={holderId} onValueChange={setHolderId}>
              <SelectTrigger id="seat-holder">
                <SelectValue placeholder="Open seat" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Someone without an app login</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {holderId === NONE && (
              <Input
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                placeholder="Type a name, or leave blank for an open seat"
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seat-roles">Roles — one per line, five or fewer</Label>
            <Textarea
              id="seat-roles"
              value={rolesText}
              onChange={(e) => setRolesText(e.target.value)}
              rows={5}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {seat ? (
            <Button
              variant="ghost"
              className="text-red-500 hover:text-red-500"
              onClick={() =>
                startTransition(async () => {
                  await deleteSeat(seat.id);
                  onClose();
                })
              }
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete seat and everything under it
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
              {seat ? "Save" : "Add"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

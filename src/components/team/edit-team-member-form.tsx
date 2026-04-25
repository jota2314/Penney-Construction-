"use client";

import { useState, useTransition } from "react";
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
import { updateTeamMember } from "@/lib/actions/team";
import type { TeamMember } from "@/lib/actions/team-types";
import { Pencil, X } from "lucide-react";
import type { UserRole } from "@/types/auth";

const ALL_ROLES: { value: UserRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "precon_manager", label: "Pre-Con Manager" },
  { value: "project_manager", label: "Project Manager" },
  { value: "office_admin", label: "Office Admin" },
  { value: "field", label: "Field Crew" },
];

interface Props {
  member: TeamMember;
  canEditRole: boolean;
}

export function EditTeamMemberForm({ member, canEditRole }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState(member.full_name);
  const [role, setRole] = useState<UserRole>(member.role ?? "project_manager");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [title, setTitle] = useState(member.title ?? "");
  const [hourlyRate, setHourlyRate] = useState(
    member.hourly_rate !== null ? String(member.hourly_rate) : ""
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateTeamMember(member.id, {
        full_name: fullName,
        role: canEditRole ? role : undefined,
        phone: phone || null,
        title: canEditRole ? title || null : undefined,
        hourly_rate: canEditRole && hourlyRate ? parseFloat(hourlyRate) : canEditRole ? null : undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4 mr-2" />
        Edit
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Edit profile</h3>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="edit-name">Full name</Label>
        <Input
          id="edit-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="edit-phone">Phone</Label>
        <Input
          id="edit-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      {canEditRole && member.kind === "office" && (
        <div className="grid gap-2">
          <Label htmlFor="edit-role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
            <SelectTrigger id="edit-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {canEditRole && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lead Carpenter"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-rate">Hourly rate ($)</Label>
            <Input
              id="edit-rate"
              type="number"
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}

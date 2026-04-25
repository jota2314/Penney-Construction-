"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTeamMember } from "@/lib/actions/team";
import { UserPlus } from "lucide-react";
import type { UserRole } from "@/types/auth";

const OFFICE_ROLES: { value: UserRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "precon_manager", label: "Pre-Con Manager" },
  { value: "project_manager", label: "Project Manager" },
  { value: "office_admin", label: "Office Admin" },
];

export function CreateTeamMemberDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<"office" | "field">("office");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("project_manager");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");

  function reset() {
    setEmail("");
    setFullName("");
    setRole("project_manager");
    setPhone("");
    setTitle("");
    setHourlyRate("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createTeamMember({
        kind,
        email,
        full_name: fullName,
        role: kind === "office" ? role : undefined,
        phone: phone || undefined,
        title: kind === "field" ? title || undefined : undefined,
        hourly_rate: kind === "field" && hourlyRate ? parseFloat(hourlyRate) : undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4 mr-2" />
          Add Team Member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Pre-create a profile. They&apos;ll be auto-linked when they sign in with Google.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={kind === "office" ? "default" : "outline"}
                onClick={() => setKind("office")}
              >
                Office
              </Button>
              <Button
                type="button"
                variant={kind === "field" ? "default" : "outline"}
                onClick={() => setKind("field")}
              >
                Field
              </Button>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="Jane Doe"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email">
                Email {kind === "field" ? "(optional)" : ""}
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required={kind === "office"}
                placeholder="jane@penneyconstructioninc.com"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
              />
            </div>

            {kind === "office" ? (
              <div className="grid gap-2">
                <Label htmlFor="role">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OFFICE_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Laborer, Carpenter, etc."
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="hourlyRate">Hourly rate ($)</Label>
                  <Input
                    id="hourlyRate"
                    type="number"
                    step="0.01"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    placeholder="25.00"
                  />
                </div>
              </>
            )}

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

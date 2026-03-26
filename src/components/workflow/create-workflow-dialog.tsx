"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { createWorkflow } from "@/lib/actions/workflow";
import { Plus, Loader2 } from "lucide-react";
import type { Profile } from "@/types/database";

const PROJECT_TYPES = [
  { value: "remodel", label: "Remodel" },
  { value: "addition", label: "Addition" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "new_construction", label: "New Construction" },
  { value: "other", label: "Other" },
];

interface CreateWorkflowDialogProps {
  profiles?: Profile[];
}

export function CreateWorkflowDialog({ profiles = [] }: CreateWorkflowDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await createWorkflow({
        project_name: form.get("project_name") as string,
        client_name: form.get("client_name") as string,
        client_email: (form.get("client_email") as string) || undefined,
        client_phone: (form.get("client_phone") as string) || undefined,
        project_address: (form.get("project_address") as string) || undefined,
        project_city: (form.get("project_city") as string) || undefined,
        project_state: (form.get("project_state") as string) || undefined,
        project_zip: (form.get("project_zip") as string) || undefined,
        project_type: (form.get("project_type") as string) || undefined,
        project_description: (form.get("project_description") as string) || undefined,
        assigned_estimator: (form.get("assigned_estimator") as string) || undefined,
        walkthrough_date: (form.get("walkthrough_date") as string)
          ? new Date(form.get("walkthrough_date") as string).toISOString()
          : undefined,
      });

      if (result.error) {
        setError(result.error);
      } else {
        if (result.warnings && result.warnings.length > 0) {
          console.warn("Workflow created with warnings:", result.warnings);
          setError(`Workflow created but some integrations failed: ${result.warnings.join("; ")}`);
          // Still navigate after 3 seconds
          setTimeout(() => {
            setOpen(false);
            router.push(`/workflow/${result.id}`);
          }, 3000);
        } else {
          setOpen(false);
          router.push(`/workflow/${result.id}`);
        }
      }
    });
  }

  const estimators = profiles.filter(
    (p) => p.role === "precon_manager" || p.role === "owner"
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start New Workflow</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="project_name">Project Name *</Label>
              <Input
                id="project_name"
                name="project_name"
                required
                placeholder="e.g. Kitchen Remodel"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="client_name">Client Name *</Label>
              <Input
                id="client_name"
                name="client_name"
                required
                placeholder="Full name"
              />
            </div>

            <div>
              <Label htmlFor="client_email">Client Email</Label>
              <Input
                id="client_email"
                name="client_email"
                type="email"
                placeholder="email@example.com"
              />
            </div>

            <div>
              <Label htmlFor="client_phone">Client Phone</Label>
              <Input
                id="client_phone"
                name="client_phone"
                type="tel"
                placeholder="(555) 000-0000"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="project_address">Project Address</Label>
              <Input
                id="project_address"
                name="project_address"
                placeholder="Street address"
              />
            </div>

            <div>
              <Label htmlFor="project_city">City</Label>
              <Input id="project_city" name="project_city" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="project_state">State</Label>
                <Input id="project_state" name="project_state" />
              </div>
              <div>
                <Label htmlFor="project_zip">Zip</Label>
                <Input id="project_zip" name="project_zip" />
              </div>
            </div>

            <div>
              <Label htmlFor="project_type">Project Type</Label>
              <Select name="project_type">
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="walkthrough_date">Walkthrough Date</Label>
              <Input
                id="walkthrough_date"
                name="walkthrough_date"
                type="datetime-local"
              />
            </div>

            {estimators.length > 0 && (
              <div className="col-span-2">
                <Label htmlFor="assigned_estimator">Assign Estimator</Label>
                <Select name="assigned_estimator">
                  <SelectTrigger>
                    <SelectValue placeholder="Select estimator" />
                  </SelectTrigger>
                  <SelectContent>
                    {estimators.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="col-span-2">
              <Label htmlFor="project_description">Project Description</Label>
              <Textarea
                id="project_description"
                name="project_description"
                rows={3}
                placeholder="Describe the project scope..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start Workflow
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

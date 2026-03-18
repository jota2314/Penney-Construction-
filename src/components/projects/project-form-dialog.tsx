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
import { createProject, updateProject } from "@/lib/actions/projects";
import { createCustomer } from "@/lib/actions/customers";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { CustomerPicker, type CustomerOption } from "@/components/leads/customer-picker";
import {
  ALL_STATUSES,
  ALL_PROJECT_TYPES,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
} from "@/lib/constants/project";
import type { Project, Customer, ProjectStatus, ProjectType, ReferralSource } from "@/types/database";

const REFERRAL_OPTIONS: { value: ReferralSource; label: string }[] = [
  { value: "referral", label: "Referral" },
  { value: "google", label: "Google" },
  { value: "facebook", label: "Facebook" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
  customers: Customer[];
  teamMembers: TeamMember[];
  /** "crm" shows pre-con intake fields; "projects" shows PM fields */
  mode?: "crm" | "projects";
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  customers,
  teamMembers,
  mode = "crm",
}: ProjectFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "lead");
  const [projectType, setProjectType] = useState<ProjectType>(project?.project_type ?? "remodel");
  const [customerId, setCustomerId] = useState(project?.customer_id ?? "");
  const [assignedPm, setAssignedPm] = useState(project?.assigned_pm ?? "");
  const [assignedEstimator, setAssignedEstimator] = useState(
    project?.assigned_estimator ?? ""
  );
  const [city, setCity] = useState(project?.city ?? "");
  const [state, setState] = useState(project?.state ?? "");
  const [zip, setZip] = useState(project?.zip ?? "");
  const [addressDefault, setAddressDefault] = useState(project?.address ?? "");
  const [addressKey, setAddressKey] = useState(0);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [referralSource, setReferralSource] = useState<ReferralSource | "">(
    (project?.referral_source as ReferralSource) ?? ""
  );
  const [walkthroughAssignedTo, setWalkthroughAssignedTo] = useState(
    project?.walkthrough_assigned_to ?? ""
  );
  const isEditing = !!project;
  const isCrm = mode === "crm" && !isEditing;
  // Avoid TS narrowing issues — project may be null in non-edit branches
  const p = project as Project | null;

  function handleCustomerSelect(customer: CustomerOption | null) {
    if (customer) {
      setCustomerId(customer.id);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerEmail("");
      if (!project?.address) {
        setAddressDefault(customer.address ?? "");
        setCity(customer.city ?? "");
        setState(customer.state ?? "");
        setZip(customer.zip ?? "");
        setAddressKey((k) => k + 1);
      }
    } else {
      setCustomerId("");
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    // Create customer inline if a new name was entered
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && newCustomerName.trim()) {
      const parts = newCustomerName.trim().split(/\s+/);
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || firstName;
      const custResult = await createCustomer({
        first_name: firstName,
        last_name: lastName,
        phone: newCustomerPhone || undefined,
        email: newCustomerEmail || undefined,
        address: form.get("address") as string,
        city: form.get("city") as string,
        state: form.get("state") as string,
        zip: form.get("zip") as string,
      });
      if (!custResult.error && custResult.id) {
        resolvedCustomerId = custResult.id;
      }
    }

    const input = {
      name: form.get("name") as string,
      customer_id: resolvedCustomerId || undefined,
      status: status as Project["status"],
      project_type: projectType as Project["project_type"],
      description: form.get("description") as string,
      address: form.get("address") as string,
      city: form.get("city") as string,
      state: form.get("state") as string,
      zip: form.get("zip") as string,
      estimated_start_date: (form.get("estimated_start_date") as string) || undefined,
      estimated_end_date: (form.get("estimated_end_date") as string) || undefined,
      estimated_value: parseFloat(form.get("estimated_value") as string) || undefined,
      contract_value: parseFloat(form.get("contract_value") as string) || undefined,
      assigned_pm: assignedPm || undefined,
      assigned_estimator: assignedEstimator || undefined,
      notes: form.get("notes") as string,
      referral_source: referralSource || undefined,
      referral_detail: (form.get("referral_detail") as string) || undefined,
      walkthrough_scheduled_at: (form.get("walkthrough_date") as string) || undefined,
      walkthrough_assigned_to: walkthroughAssignedTo || undefined,
    };

    const result = isEditing
      ? await updateProject(project.id, input)
      : await createProject(input);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
    }
  }

  const dialogTitle = isEditing
    ? "Edit Project"
    : isCrm
      ? "New Lead"
      : "New Project";

  const submitLabel = isEditing
    ? "Save Changes"
    : isCrm
      ? "Create Lead"
      : "Create Project";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {/* Project Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">{isCrm ? "Lead Name *" : "Project Name *"}</Label>
            <Input
              id="name"
              name="name"
              required
              placeholder={isCrm ? "e.g. Smith Kitchen Remodel" : ""}
              defaultValue={p?.name ?? ""}
            />
          </div>

          {/* Customer picker */}
          <div className="grid gap-2">
            <Label>Customer</Label>
            <CustomerPicker
              selectedId={customerId || null}
              onSelect={handleCustomerSelect}
              onNewCustomer={() => {
                setCustomerId("");
                setNewCustomerName("");
              }}
            />
            {!customerId && (
              <div className="grid gap-2">
                <Input
                  placeholder="New customer name (e.g. John Smith)"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Phone"
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                  />
                  <Input
                    placeholder="Email"
                    type="email"
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Address */}
          <div className="grid gap-2">
            <Label htmlFor="address">Address</Label>
            <AddressAutocomplete
              key={addressKey}
              defaultValue={addressDefault}
              onPlaceSelect={(parts) => {
                setCity(parts.city);
                setState(parts.state);
                setZip(parts.zip);
              }}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="zip">Zip</Label>
              <Input id="zip" name="zip" value={zip} onChange={(e) => setZip(e.target.value)} />
            </div>
          </div>

          {/* Project Type — always visible */}
          <div className="grid gap-2">
            <Label>Project Type *</Label>
            <Select value={projectType} onValueChange={(v) => setProjectType(v as ProjectType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_PROJECT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {PROJECT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── CRM / Pre-Con fields ── */}
          {isCrm && (
            <>
              {/* How did you hear about us? */}
              <div className="grid gap-2">
                <Label>How did you hear about us?</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    value={referralSource}
                    onValueChange={(v) => setReferralSource(v as ReferralSource)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Source..." />
                    </SelectTrigger>
                    <SelectContent>
                      {REFERRAL_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    name="referral_detail"
                    placeholder="Name or details..."
                    defaultValue={p?.referral_detail ?? ""}
                  />
                </div>
              </div>

              {/* Brief description */}
              <div className="grid gap-2">
                <Label htmlFor="description">Brief Job Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  placeholder="e.g. Full kitchen remodel, new cabinets and countertops..."
                  defaultValue={p?.description ?? ""}
                />
              </div>

              {/* Schedule walkthrough */}
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="walkthrough_date">Walkthrough Date</Label>
                  <Input
                    id="walkthrough_date"
                    name="walkthrough_date"
                    type="datetime-local"
                    defaultValue={p?.walkthrough_scheduled_at
                      ? new Date(new Date(p.walkthrough_scheduled_at).getTime() - new Date(p.walkthrough_scheduled_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                      : ""}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Assign To</Label>
                  <Select
                    value={walkthroughAssignedTo}
                    onValueChange={(v) => setWalkthroughAssignedTo(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Who's going?" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {teamMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name ?? m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {/* ── Edit / Project Management fields ── */}
          {(isEditing || mode !== "crm") && (
            <>
              {/* Status */}
              <div className="grid gap-2">
                <Label>Status *</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {PROJECT_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Description (for edit mode) */}
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  defaultValue={p?.description ?? ""}
                />
              </div>

              {/* Referral (for edit mode) */}
              <div className="grid gap-2">
                <Label>Referral Source</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    value={referralSource}
                    onValueChange={(v) => setReferralSource(v as ReferralSource)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Source..." />
                    </SelectTrigger>
                    <SelectContent>
                      {REFERRAL_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    name="referral_detail"
                    placeholder="Details..."
                    defaultValue={p?.referral_detail ?? ""}
                  />
                </div>
              </div>

              {/* Walkthrough (edit mode) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="walkthrough_date">Walkthrough Date</Label>
                  <Input
                    id="walkthrough_date"
                    name="walkthrough_date"
                    type="datetime-local"
                    defaultValue={p?.walkthrough_scheduled_at
                      ? new Date(new Date(p.walkthrough_scheduled_at).getTime() - new Date(p.walkthrough_scheduled_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                      : ""}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Assign To</Label>
                  <Select
                    value={walkthroughAssignedTo}
                    onValueChange={(v) => setWalkthroughAssignedTo(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Who's going?" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {teamMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name ?? m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="estimated_start_date">Est. Start Date</Label>
                  <Input
                    id="estimated_start_date"
                    name="estimated_start_date"
                    type="date"
                    defaultValue={p?.estimated_start_date ?? ""}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="estimated_end_date">Est. End Date</Label>
                  <Input
                    id="estimated_end_date"
                    name="estimated_end_date"
                    type="date"
                    defaultValue={p?.estimated_end_date ?? ""}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="estimated_value">Estimated Value ($)</Label>
                  <Input
                    id="estimated_value"
                    name="estimated_value"
                    type="number"
                    step="0.01"
                    defaultValue={p?.estimated_value ?? ""}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contract_value">Contract Value ($)</Label>
                  <Input
                    id="contract_value"
                    name="contract_value"
                    type="number"
                    step="0.01"
                    defaultValue={p?.contract_value ?? ""}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Assigned PM</Label>
                  <Select value={assignedPm} onValueChange={(v) => setAssignedPm(v === "none" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select PM" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {teamMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name ?? m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Assigned Estimator</Label>
                  <Select
                    value={assignedEstimator}
                    onValueChange={(v) => setAssignedEstimator(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Estimator" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {teamMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name ?? m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  defaultValue={p?.notes ?? ""}
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

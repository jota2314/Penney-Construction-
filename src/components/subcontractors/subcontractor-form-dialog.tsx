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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createSubcontractor,
  updateSubcontractor,
} from "@/lib/actions/subcontractors";
import {
  TRADE_OPTIONS,
  ALL_VETTING_STATUSES,
  VETTING_STATUS_LABELS,
} from "@/lib/constants/subcontractor";
import type { Subcontractor, VettingStatus } from "@/types/database";

interface SubcontractorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subcontractor?: Subcontractor | null;
}

export function SubcontractorFormDialog({
  open,
  onOpenChange,
  subcontractor,
}: SubcontractorFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrades, setSelectedTrades] = useState<string[]>(
    subcontractor?.trades ?? []
  );
  const [vettingStatus, setVettingStatus] = useState<VettingStatus>(
    subcontractor?.vetting_status ?? "prospect"
  );
  const isEditing = !!subcontractor;

  function toggleTrade(trade: string) {
    setSelectedTrades((prev) =>
      prev.includes(trade) ? prev.filter((t) => t !== trade) : [...prev, trade]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const ratingVal = form.get("rating") as string;
    const input = {
      company_name: form.get("company_name") as string,
      contact_name: form.get("contact_name") as string,
      email: form.get("email") as string,
      phone: form.get("phone") as string,
      address: form.get("address") as string,
      city: form.get("city") as string,
      state: form.get("state") as string,
      zip: form.get("zip") as string,
      trades: selectedTrades,
      license_number: form.get("license_number") as string,
      insurance_expiry: form.get("insurance_expiry") as string,
      rating: ratingVal ? Number(ratingVal) : undefined,
      notes: form.get("notes") as string,
      is_active: form.get("is_active") === "on",
      vetting_status: vettingStatus,
    };

    const result = isEditing
      ? await updateSubcontractor(subcontractor.id, input)
      : await createSubcontractor(input);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) setSelectedTrades([]);
        onOpenChange(val);
      }}
    >
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Subcontractor" : "New Subcontractor"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="company_name">Company Name *</Label>
            <Input
              id="company_name"
              name="company_name"
              required
              defaultValue={subcontractor?.company_name ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="contact_name">Contact Name</Label>
              <Input
                id="contact_name"
                name="contact_name"
                defaultValue={subcontractor?.contact_name ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={subcontractor?.phone ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={subcontractor?.email ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              name="address"
              defaultValue={subcontractor?.address ?? ""}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                defaultValue={subcontractor?.city ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                name="state"
                defaultValue={subcontractor?.state ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="zip">Zip</Label>
              <Input
                id="zip"
                name="zip"
                defaultValue={subcontractor?.zip ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Trades</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto rounded-md border p-3">
              {TRADE_OPTIONS.map((trade) => (
                <label
                  key={trade}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={selectedTrades.includes(trade)}
                    onCheckedChange={() => toggleTrade(trade)}
                  />
                  {trade}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="license_number">License #</Label>
              <Input
                id="license_number"
                name="license_number"
                defaultValue={subcontractor?.license_number ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="insurance_expiry">Insurance Expiry</Label>
              <Input
                id="insurance_expiry"
                name="insurance_expiry"
                type="date"
                defaultValue={subcontractor?.insurance_expiry ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rating">Rating (1-5)</Label>
              <Input
                id="rating"
                name="rating"
                type="number"
                min={1}
                max={5}
                defaultValue={subcontractor?.rating ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={subcontractor?.notes ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="vetting_status">Vetting Status</Label>
              <Select
                value={vettingStatus}
                onValueChange={(v) => setVettingStatus(v as VettingStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_VETTING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {VETTING_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Checkbox
                id="is_active"
                name="is_active"
                defaultChecked={subcontractor?.is_active ?? true}
              />
              <Label htmlFor="is_active" className="cursor-pointer">
                Active
              </Label>
            </div>
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
                  : "Create Subcontractor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

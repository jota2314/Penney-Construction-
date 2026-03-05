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
import {
  SITE_VISIT_TYPE_LABELS,
  ALL_SITE_VISIT_TYPES,
} from "@/lib/constants/site-visit";
import type { Estimate, SiteVisitType } from "@/types/database";

interface EstimationSiteVisitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimates: Pick<Estimate, "id" | "name">[];
}

export function EstimationSiteVisitFormDialog({
  open,
  onOpenChange,
  estimates,
}: EstimationSiteVisitFormDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [visitType, setVisitType] = useState<SiteVisitType>("pricing");
  const [purpose, setPurpose] = useState("");
  const [estimateId, setEstimateId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!address.trim()) {
      setError("Address is required.");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await createSiteVisit({
      name: name.trim(),
      address: address.trim(),
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      visit_type: visitType,
      purpose: purpose || undefined,
      estimate_id: estimateId || undefined,
    });

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      setName("");
      setAddress("");
      setCity("");
      setState("");
      setZip("");
      setVisitType("pricing");
      setPurpose("");
      setEstimateId("");
      router.push(`/site-visits/${result.id}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Estimation Site Visit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="est-name">Name *</Label>
            <Input
              id="est-name"
              placeholder="e.g. Smith Kitchen"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="est-address">Address *</Label>
            <Input
              id="est-address"
              placeholder="123 Main St"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2">
              <Label htmlFor="est-city">City</Label>
              <Input
                id="est-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="est-state">State</Label>
              <Input
                id="est-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="est-zip">Zip</Label>
              <Input
                id="est-zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Visit Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {ALL_SITE_VISIT_TYPES.map((type) => {
                const descriptions: Record<SiteVisitType, string> = {
                  pricing: "Scope & estimate",
                  progress: "Active job check",
                  punch_list: "Final walkthrough",
                };
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setVisitType(type)}
                    className={`rounded-lg border-2 p-2.5 text-left transition-colors ${
                      visitType === type
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/30"
                    }`}
                  >
                    <span className="text-sm font-medium block">
                      {SITE_VISIT_TYPE_LABELS[type]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {descriptions[type]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="est-purpose">Purpose (optional)</Label>
            <Input
              id="est-purpose"
              placeholder="e.g. Measure kitchen, check plumbing"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="est-estimate">Link to Estimate (optional)</Label>
            <Select value={estimateId} onValueChange={setEstimateId}>
              <SelectTrigger id="est-estimate" className="min-h-[44px]">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {estimates.map((est) => (
                  <SelectItem key={est.id} value={est.id}>
                    {est.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={loading || !name.trim() || !address.trim()}>
              {loading ? "Starting..." : "Start Visit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

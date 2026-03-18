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
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { createWalkthrough } from "@/lib/actions/walkthroughs";
import type { Estimate } from "@/types/database";

interface WalkthroughFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimates: Pick<Estimate, "id" | "name">[];
}

export function WalkthroughFormDialog({
  open,
  onOpenChange,
  estimates,
}: WalkthroughFormDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
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

    const result = await createWalkthrough({
      name: name.trim(),
      address: address.trim(),
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      purpose: purpose || undefined,
      estimate_id: estimateId && estimateId !== "none" ? estimateId : undefined,
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
      setPurpose("");
      setEstimateId("");
      router.push(`/walkthroughs/${result.id}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Walkthrough</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wt-name">Name *</Label>
            <Input
              id="wt-name"
              placeholder="e.g. Smith Kitchen"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wt-address">Address *</Label>
            <AddressAutocomplete
              id="wt-address"
              name="wt-address"
              defaultValue={address}
              className="min-h-[44px]"
              onChange={(e) => setAddress(e.target.value)}
              onPlaceSelect={(parts) => {
                setAddress(parts.address);
                setCity(parts.city);
                setState(parts.state);
                setZip(parts.zip);
              }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2">
              <Label htmlFor="wt-city">City</Label>
              <Input
                id="wt-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wt-state">State</Label>
              <Input
                id="wt-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wt-zip">Zip</Label>
              <Input
                id="wt-zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wt-purpose">Purpose (optional)</Label>
            <Input
              id="wt-purpose"
              placeholder="e.g. Measure kitchen, check plumbing"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wt-estimate">Link to Estimate (optional)</Label>
            <Select value={estimateId} onValueChange={setEstimateId}>
              <SelectTrigger id="wt-estimate" className="min-h-[44px]">
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
              {loading ? "Starting..." : "Start Walkthrough"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

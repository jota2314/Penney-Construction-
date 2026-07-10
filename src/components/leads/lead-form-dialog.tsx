"use client";

import { useState, useRef } from "react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Mic, MicOff, Sparkles, Loader2 } from "lucide-react";
import { createLead, updateLead } from "@/lib/actions/leads";
import { createCustomer } from "@/lib/actions/customers";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { CustomerPicker, type CustomerOption } from "./customer-picker";
import {
  ALL_URGENCIES,
  URGENCY_LABELS,
} from "@/lib/constants/lead";
import { ALL_PROJECT_TYPES, PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { Lead, ProjectType, ReferralSource, LeadUrgency } from "@/types/database";

// Map referral source values to simple labels for the dropdown
const REFERRAL_OPTIONS: { value: ReferralSource; label: string }[] = [
  { value: "referral", label: "Referral" },
  { value: "google", label: "Google" },
  { value: "facebook", label: "Facebook" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

interface LeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead | null;
  onCreated?: (leadId: string) => void;
}

export function LeadFormDialog({
  open,
  onOpenChange,
  lead,
  onCreated,
}: LeadFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [projectType, setProjectType] = useState<ProjectType | "">(
    lead?.project_type ?? ""
  );
  const [referralSource, setReferralSource] = useState<ReferralSource | "">(
    lead?.referral_source ?? ""
  );
  const [urgency, setUrgency] = useState<LeadUrgency>(
    lead?.urgency ?? "unknown"
  );
  const [description, setDescription] = useState(lead?.description ?? "");
  const [recording, setRecording] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Customer linking
  const [customerId, setCustomerId] = useState<string | null>(
    lead?.customer_id ?? null
  );
  const [firstName, setFirstName] = useState(lead?.first_name ?? "");
  const [lastName, setLastName] = useState(lead?.last_name ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");

  // Address parts managed via state so autocomplete can fill city/state/zip
  const [address, setAddress] = useState(lead?.address ?? "");
  const [city, setCity] = useState(lead?.city ?? "");
  const [state, setState] = useState(lead?.state ?? "");
  const [zip, setZip] = useState(lead?.zip ?? "");

  // Key to reset AddressAutocomplete when customer is picked
  const [addressKey, setAddressKey] = useState(0);

  const isEditing = !!lead;

  function handleCustomerSelect(customer: CustomerOption | null) {
    if (customer) {
      setCustomerId(customer.id);
      setFirstName(customer.first_name);
      setLastName(customer.last_name);
      setPhone(customer.phone ?? "");
      setEmail(customer.email ?? "");
      setAddress(customer.address ?? "");
      setCity(customer.city ?? "");
      setState(customer.state ?? "");
      setZip(customer.zip ?? "");
      setAddressKey((k) => k + 1);
    } else {
      setCustomerId(null);
    }
  }

  // ── Voice dictation ──────────────────────────────────
  function handleVoiceToggle() {
    if (recording && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setRecording(false);
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    // Android re-delivers already-final results in continuous mode (doubled
    // words); single-utterance sessions avoid it — Android ends recognition
    // after each pause either way.
    recognition.continuous = !/android/i.test(navigator.userAgent);
    recognition.interimResults = false;
    recognition.lang = "en-US";

    // Rebuild finals from the full result list every event and append only the
    // unseen tail — Android re-fires events with already-final results.
    let committed = "";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let spoken = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          spoken += (spoken ? " " : "") + event.results[i][0].transcript.trim();
        }
      }
      if (spoken.length <= committed.length) return;
      const transcript = spoken.slice(committed.length).trim();
      committed = spoken;
      if (transcript) {
        setDescription((prev) => {
          const separator = prev.trim() ? " " : "";
          return prev + separator + transcript;
        });
      }
    };

    recognition.onerror = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setRecording(true);
    recognition.start();
  }

  async function handleCleanUp() {
    if (!description.trim() || cleaning) return;
    setCleaning(true);
    try {
      const res = await fetch("/api/clean-dictation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: description }),
      });
      const data = await res.json();
      if (data.cleaned) {
        setDescription(data.cleaned);
      }
    } catch {
      setError("Failed to clean up text");
    } finally {
      setCleaning(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Stop recording if active
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setRecording(false);
    }

    const form = new FormData(e.currentTarget);
    const fName = form.get("first_name") as string;
    const lName = form.get("last_name") as string;
    const ph = form.get("phone") as string;
    const em = form.get("email") as string;
    const addr = form.get("address") as string;
    const ct = form.get("city") as string;
    const st = form.get("state") as string;
    const zp = form.get("zip") as string;

    // Auto-create customer if none selected and we have a name
    let resolvedCustomerId = customerId;
    if (!isEditing && !resolvedCustomerId && fName && lName) {
      const custResult = await createCustomer({
        first_name: fName,
        last_name: lName,
        phone: ph,
        email: em,
        address: addr,
        city: ct,
        state: st,
        zip: zp,
      });
      if (!custResult.error && custResult.id) {
        resolvedCustomerId = custResult.id;
      }
    }

    const input = {
      first_name: fName,
      last_name: lName,
      phone: ph,
      email: em,
      address: addr,
      city: ct,
      state: st,
      zip: zp,
      description,
      referral_source: referralSource || undefined,
      referral_detail: form.get("referral_detail") as string,
      project_type: projectType || undefined,
      budget_min: form.get("budget_min")
        ? Number(form.get("budget_min"))
        : undefined,
      budget_max: form.get("budget_max")
        ? Number(form.get("budget_max"))
        : undefined,
      urgency,
      timeline_notes: form.get("timeline_notes") as string,
      customer_id: resolvedCustomerId || undefined,
    };

    const result = isEditing
      ? await updateLead(lead.id, input)
      : await createLead(input);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      if (!isEditing && onCreated && "id" in result && result.id) {
        onCreated(result.id as string);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Lead" : "New Lead"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {/* 0. Customer picker — search existing or create new */}
          {!isEditing && (
            <div className="grid gap-1.5">
              <Label>Customer</Label>
              <CustomerPicker
                selectedId={customerId}
                onSelect={handleCustomerSelect}
                onNewCustomer={() => {
                  setFirstName("");
                  setLastName("");
                  setPhone("");
                  setEmail("");
                  setAddress("");
                  setCity("");
                  setState("");
                  setZip("");
                  setAddressKey((k) => k + 1);
                }}
              />
            </div>
          )}

          {/* 1. Client name */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="first_name">Client First Name *</Label>
              <Input
                id="first_name"
                name="first_name"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="last_name">Last Name *</Label>
              <Input
                id="last_name"
                name="last_name"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          {/* 2. Address with autocomplete */}
          <div className="grid gap-1.5">
            <Label htmlFor="address">Address</Label>
            <AddressAutocomplete
              key={addressKey}
              defaultValue={address}
              onPlaceSelect={(parts) => {
                setAddress(parts.address);
                setCity(parts.city);
                setState(parts.state);
                setZip(parts.zip);
              }}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                name="state"
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="zip">Zip</Label>
              <Input
                id="zip"
                name="zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
              />
            </div>
          </div>

          {/* 3. Phone */}
          <div className="grid gap-1.5">
            <Label htmlFor="phone">Preferred Phone Number</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          {/* 4. Email */}
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* 5. How did you hear about us? */}
          <div className="grid gap-1.5">
            <Label>How did you hear about us?</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                defaultValue={lead?.referral_detail ?? ""}
              />
            </div>
          </div>

          {/* 6. Brief job description with voice */}
          <div className="grid gap-1.5">
            <Label htmlFor="description">Brief Job Description</Label>
            <div className="relative">
              <Textarea
                id="description"
                name="description"
                rows={3}
                placeholder="e.g. One 12x20 room addition, full kitchen remodel..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="pr-10 resize-y"
              />
              <button
                type="button"
                onClick={handleVoiceToggle}
                className={`absolute top-2 right-2 p-1.5 rounded transition-colors ${
                  recording
                    ? "bg-red-100 text-red-600 hover:bg-red-200 animate-pulse"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
                title={recording ? "Stop recording" : "Dictate with voice"}
              >
                {recording ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            </div>
            {description.trim() && !recording && (
              <button
                type="button"
                onClick={handleCleanUp}
                disabled={cleaning}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
              >
                {cleaning ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {cleaning ? "Cleaning up..." : "Clean up with AI"}
              </button>
            )}
          </div>

          {/* 7. Best days/times for site visit */}
          <div className="grid gap-1.5">
            <Label htmlFor="timeline_notes">Best Days/Times to Visit</Label>
            <Input
              id="timeline_notes"
              name="timeline_notes"
              placeholder="e.g. Mornings, weekends"
              defaultValue={lead?.timeline_notes ?? ""}
            />
          </div>

          {/* More details (collapsible) */}
          <Collapsible open={moreOpen || isEditing} onOpenChange={setMoreOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-between"
              >
                More Details
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${moreOpen || isEditing ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-4 pt-2">
              <div className="grid gap-1.5">
                <Label>Project Type</Label>
                <Select
                  value={projectType}
                  onValueChange={(v) => setProjectType(v as ProjectType)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type..." />
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

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="budget_min">Budget Min ($)</Label>
                  <Input
                    id="budget_min"
                    name="budget_min"
                    type="number"
                    defaultValue={lead?.budget_min ?? ""}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="budget_max">Budget Max ($)</Label>
                  <Input
                    id="budget_max"
                    name="budget_max"
                    type="number"
                    defaultValue={lead?.budget_max ?? ""}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>Urgency</Label>
                <Select
                  value={urgency}
                  onValueChange={(v) => setUrgency(v as LeadUrgency)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_URGENCIES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {URGENCY_LABELS[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CollapsibleContent>
          </Collapsible>

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
                  : "Create Lead"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

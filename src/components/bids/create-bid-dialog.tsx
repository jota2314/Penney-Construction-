"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, Send, Search, UserPlus, Globe } from "lucide-react";
import { SubFinderDialog } from "./sub-finder-dialog";
import { createBidPackage } from "@/lib/actions/bids";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";

interface CreateBidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  defaultTrade?: string;
  defaultScope?: string;
  onSuccess: () => void;
}

interface ProjectOption {
  id: string;
  name: string;
  project_number: string;
  address: string | null;
}

interface SubOption {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  trades: string[];
  vetting_status: string;
  is_active: boolean;
}

const COMMON_TRADES = [
  "Plumbing", "Electrical", "HVAC", "Framing", "Demolition", "Tile",
  "Painting", "Plaster", "Insulation", "Roofing", "Siding", "Concrete",
  "Flooring", "Cabinets", "Countertops", "Windows", "Doors", "Glass",
  "Excavation", "Drywall",
];

export function CreateBidDialog({
  open,
  onOpenChange,
  defaultProjectId,
  defaultTrade,
  defaultScope,
  onSuccess,
}: CreateBidDialogProps) {
  const [step, setStep] = useState<"details" | "subs" | "sending">("details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Details
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [trade, setTrade] = useState(defaultTrade || "");
  const [scopeOfWork, setScopeOfWork] = useState(defaultScope || "");
  const [dueDate, setDueDate] = useState("");
  const [name, setName] = useState("");

  // Step 2: Sub selection
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);
  const [subSearch, setSubSearch] = useState("");
  const [finderOpen, setFinderOpen] = useState(false);

  // Data
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [subs, setSubs] = useState<SubOption[]>([]);

  // Load projects and subs
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();

    supabase
      .from("projects")
      .select("id, name, project_number, address")
      .in("status", ["contracted", "in_progress", "estimating", "proposal_sent"])
      .order("name")
      .then(({ data }) => setProjects(data || []));

    supabase
      .from("subcontractors")
      .select("id, company_name, contact_name, email, phone, trades, vetting_status, is_active")
      .eq("is_active", true)
      .order("company_name")
      .then(({ data }) => setSubs(data || []));
  }, [open]);

  // Auto-generate name + pull trade-specific scope from estimate
  useEffect(() => {
    if (trade && projectId) {
      const proj = projects.find((p) => p.id === projectId);
      if (proj) setName(`${trade} — ${proj.name}`);

      // Fetch trade-specific scope from estimate line items
      const supabase = createClient();
      supabase
        .from("estimates")
        .select("id")
        .eq("project_id", projectId)
        .in("status", ["approved", "draft"])
        .order("version", { ascending: false })
        .limit(1)
        .then(({ data: ests }) => {
          if (!ests?.[0]) return;
          supabase
            .from("estimate_line_items")
            .select("description, scope_text, trade")
            .eq("estimate_id", ests[0].id)
            .ilike("trade", `%${trade}%`)
            .then(({ data: lines }) => {
              if (!lines?.length) return;
              const combined = lines
                .map((l) => l.scope_text || "")
                .filter(Boolean)
                .join("\n\n");
              if (combined && !scopeOfWork) setScopeOfWork(combined);
            });
        });
    }
  }, [trade, projectId, projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter subs by trade
  const tradeLower = trade.toLowerCase();
  const matchingSubs = subs.filter((s) =>
    s.trades?.some((t) => t.toLowerCase().includes(tradeLower))
  );
  const otherSubs = subs.filter(
    (s) => !s.trades?.some((t) => t.toLowerCase().includes(tradeLower))
  );

  const filteredMatching = subSearch
    ? matchingSubs.filter((s) =>
        s.company_name.toLowerCase().includes(subSearch.toLowerCase()) ||
        s.contact_name?.toLowerCase().includes(subSearch.toLowerCase())
      )
    : matchingSubs;

  const filteredOther = subSearch
    ? otherSubs.filter((s) =>
        s.company_name.toLowerCase().includes(subSearch.toLowerCase()) ||
        s.contact_name?.toLowerCase().includes(subSearch.toLowerCase())
      )
    : [];

  function toggleSub(id: string) {
    setSelectedSubs((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleSend() {
    if (!projectId || !trade || selectedSubs.length === 0) return;
    setSaving(true);
    setError(null);

    const project = projects.find((p) => p.id === projectId);

    // Create the bid package
    const result = await createBidPackage({
      project_id: projectId,
      name,
      trade,
      scope_of_work: scopeOfWork || undefined,
      due_date: dueDate || undefined,
      project_address: project?.address || undefined,
      subcontractor_ids: selectedSubs,
    });

    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }

    // Send the emails
    if (result.id) {
      setStep("sending");
      try {
        const res = await fetch("/api/send-bid-package", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bidPackageId: result.id }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        }
      } catch {
        setError("Failed to send emails");
      }
    }

    setSaving(false);
    onSuccess();
  }

  function handleClose() {
    setStep("details");
    setSelectedSubs([]);
    setSubSearch("");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "details" && "Create Bid Package"}
            {step === "subs" && `Select Subs — ${trade}`}
            {step === "sending" && "Sending RFQs..."}
          </DialogTitle>
        </DialogHeader>

        {step === "details" && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Project *</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.project_number ? `${p.project_number} — ` : ""}{p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Trade *</Label>
              <Select value={trade} onValueChange={setTrade}>
                <SelectTrigger>
                  <SelectValue placeholder="Select trade..." />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TRADES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Scope of Work</Label>
              <Textarea
                value={scopeOfWork}
                onChange={(e) => setScopeOfWork(e.target.value)}
                placeholder="Describe the work... (can pull from estimate)"
                rows={4}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Bid Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {step === "subs" && (
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search subs..."
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{selectedSubs.length} selected</span>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFinderOpen(true)}>
                <Globe className="h-3 w-3 mr-1" />
                Find New Subs
              </Button>
            </div>

            {filteredMatching.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-muted-foreground mb-1">
                  {trade} SUBS ({filteredMatching.length})
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {filteredMatching.map((sub) => (
                    <SubCheckItem
                      key={sub.id}
                      sub={sub}
                      checked={selectedSubs.includes(sub.id)}
                      onToggle={() => toggleSub(sub.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {filteredMatching.length === 0 && !subSearch && (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No subs found for &quot;{trade}&quot;. Search below or add new subs.
              </div>
            )}

            {(filteredOther.length > 0 || subSearch) && (
              <div>
                <div className="text-[11px] font-semibold text-muted-foreground mb-1">
                  OTHER SUBS
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {(subSearch ? filteredOther : otherSubs.slice(0, 10)).map((sub) => (
                    <SubCheckItem
                      key={sub.id}
                      sub={sub}
                      checked={selectedSubs.includes(sub.id)}
                      onToggle={() => toggleSub(sub.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {step === "sending" && (
          <div className="py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-amber-500" />
            <p className="text-sm text-muted-foreground">
              Sending professional RFQ emails to {selectedSubs.length} subs...
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "details" && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => setStep("subs")}
                disabled={!projectId || !trade}
              >
                Next — Select Subs
              </Button>
            </>
          )}
          {step === "subs" && (
            <>
              <Button variant="outline" onClick={() => setStep("details")}>Back</Button>
              <Button
                onClick={handleSend}
                disabled={saving || selectedSubs.length === 0}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send to {selectedSubs.length} Sub{selectedSubs.length !== 1 ? "s" : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <SubFinderDialog
        open={finderOpen}
        onOpenChange={(isOpen) => {
          setFinderOpen(isOpen);
          if (!isOpen) {
            // Refresh sub list when finder closes
            const sb = createClient();
            sb.from("subcontractors")
              .select("id, company_name, contact_name, email, phone, trades, vetting_status, is_active")
              .eq("is_active", true)
              .order("company_name")
              .then(({ data }) => setSubs(data || []));
          }
        }}
        defaultTrade={trade}
      />
    </Dialog>
  );
}

function SubCheckItem({
  sub,
  checked,
  onToggle,
}: {
  sub: SubOption;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{sub.company_name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {sub.contact_name}{sub.email ? ` — ${sub.email}` : ""}
        </div>
      </div>
      {!sub.email && (
        <Badge variant="outline" className="text-[10px] text-destructive shrink-0">No email</Badge>
      )}
      {sub.vetting_status === "approved" && (
        <Badge className="text-[10px] bg-green-500/20 text-green-400 shrink-0">Approved</Badge>
      )}
      {sub.vetting_status === "prospect" && (
        <Badge className="text-[10px] bg-amber-500/20 text-amber-400 shrink-0">Prospect</Badge>
      )}
    </label>
  );
}

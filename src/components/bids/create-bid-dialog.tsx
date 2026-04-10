"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Loader2, Send, Search, Globe, Eye, Paperclip, Mail, FileText, Edit2 } from "lucide-react";
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
  const [step, setStep] = useState<"details" | "subs" | "preview" | "sending">("details");
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

  // Step 3: Preview
  const [previewLoading, setPreviewLoading] = useState(false);
  const [attachmentNames, setAttachmentNames] = useState<string[]>([]);
  const [editingBody, setEditingBody] = useState(false);
  const [emailBody, setEmailBody] = useState("");

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

  // Computed preview data
  const project = projects.find((p) => p.id === projectId);
  const selectedSubDetails = subs.filter((s) => selectedSubs.includes(s.id));
  const previewSubject = `Request for Quote — ${trade} | ${project?.name || ""}`;
  const projectAddress = project?.address || "TBD";
  const dueDateFormatted = dueDate
    ? new Date(dueDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "ASAP";

  // Build the email body for preview
  const buildEmailBody = useCallback(() => {
    const scope = scopeOfWork || "See attached documents for scope details.";
    return `Hi {{contactName}},

Penney Construction is requesting a quote for the following scope of work:

PROJECT: ${project?.name || ""}
ADDRESS: ${projectAddress}
TRADE: ${trade}
BID DUE BY: ${dueDateFormatted}

SCOPE OF WORK:
${scope}

Please reply to this email with your quote, or call Jorge at (978) 473-0183.

Thank you,`;
  }, [project, projectAddress, trade, dueDateFormatted, scopeOfWork]);

  // Load preview: check available attachments
  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setEditingBody(false);
    setEmailBody(buildEmailBody());

    try {
      const res = await fetch("/api/preview-bid-attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      setAttachmentNames(data.files || []);
    } catch {
      setAttachmentNames([]);
    }

    setPreviewLoading(false);
  }, [projectId, buildEmailBody]);

  async function handleSend() {
    if (!projectId || !trade || selectedSubs.length === 0) return;
    setSaving(true);
    setError(null);

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

    // Send the emails with custom body if edited
    if (result.id) {
      setStep("sending");
      try {
        const body: Record<string, string> = { bidPackageId: result.id };
        if (editingBody) body.customBody = emailBody;
        const res = await fetch("/api/send-bid-package", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
    setEditingBody(false);
    setEmailBody("");
    setAttachmentNames([]);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "details" && "Create Bid Package"}
            {step === "subs" && `Select Subs — ${trade}`}
            {step === "preview" && "Review Email Before Sending"}
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
                placeholder="Auto-fills from estimate when you pick a trade..."
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

        {step === "preview" && (
          <div className="space-y-4 py-2">
            {previewLoading ? (
              <div className="py-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
                <p className="text-xs text-muted-foreground">Loading preview...</p>
              </div>
            ) : (
              <>
                {/* Recipients */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase">
                    <Mail className="h-3 w-3" /> Sending to
                  </div>
                  <div className="space-y-1">
                    {selectedSubDetails.map((sub) => (
                      <div key={sub.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-muted/40">
                        <span className="font-medium">{sub.company_name}</span>
                        <span className="text-muted-foreground">{sub.contact_name}</span>
                        <span className="text-muted-foreground ml-auto">{sub.email}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Subject */}
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase">Subject</div>
                  <div className="text-sm font-medium px-2 py-1.5 rounded bg-muted/40">{previewSubject}</div>
                </div>

                {/* Email Body */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase">
                      <FileText className="h-3 w-3" /> Email Body
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2"
                      onClick={() => setEditingBody(!editingBody)}
                    >
                      <Edit2 className="h-3 w-3 mr-1" />
                      {editingBody ? "Done" : "Edit"}
                    </Button>
                  </div>
                  {editingBody ? (
                    <Textarea
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      rows={12}
                      className="text-xs font-mono"
                    />
                  ) : (
                    <div className="text-xs whitespace-pre-wrap px-3 py-2.5 rounded border bg-muted/20 max-h-64 overflow-y-auto leading-relaxed">
                      {emailBody.replace("{{contactName}}", selectedSubDetails[0]?.contact_name || selectedSubDetails[0]?.company_name || "[Name]")}
                    </div>
                  )}
                </div>

                {/* Attachments */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase">
                    <Paperclip className="h-3 w-3" /> Attachments ({attachmentNames.length})
                  </div>
                  {attachmentNames.length > 0 ? (
                    <div className="space-y-1">
                      {attachmentNames.map((name, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-green-500/10 text-green-400">
                          <Paperclip className="h-3 w-3 shrink-0" />
                          <span className="truncate">{name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-amber-400 px-2 py-1.5 rounded bg-amber-500/10">
                      No drawings/plans found. Upload files to the project or forward plans via email.
                    </div>
                  )}
                </div>
              </>
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
                onClick={() => { setStep("preview"); loadPreview(); }}
                disabled={selectedSubs.length === 0}
              >
                <Eye className="mr-2 h-4 w-4" />
                Review Email
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("subs")}>Back</Button>
              <Button
                onClick={handleSend}
                disabled={saving || previewLoading}
                className="bg-green-600 hover:bg-green-700"
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Confirm & Send to {selectedSubs.length} Sub{selectedSubs.length !== 1 ? "s" : ""}
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

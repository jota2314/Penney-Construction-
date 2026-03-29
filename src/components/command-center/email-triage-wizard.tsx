"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Check,
  SkipForward,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  CheckCheck,
  X,
  Plus,
  FolderOpen,
  Paperclip,
  FileText,
} from "lucide-react";

// ── Types ──────────────────

export interface TriageEmail {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  toEmail: string;
  date: string;
  direction: "inbound" | "outbound";
  snippet: string;
  attachments?: { filename: string; mimeType: string; attachmentId: string; size: number }[];
}

export interface TriageAction {
  type: string;
  data: Record<string, unknown>;
}

export interface TriageItem {
  email: TriageEmail;
  actions: TriageAction[];
  status: "pending" | "confirmed" | "skipped" | "edited";
}

interface CreatedProject {
  name: string;
  project_type: string;
  status: string;
  address?: string;
  city?: string;
  customer_name?: string;
}

interface EmailTriageWizardProps {
  items: TriageItem[];
  isScanning?: boolean;
  onComplete: (confirmed: TriageItem[]) => Promise<void>;
  onCancel: () => void;
}

// ── Helpers ──────────────────

function summarizeActions(actions: TriageAction[]): string {
  if (actions.length === 0 || (actions.length === 1 && actions[0].type === "skip")) {
    return "No action needed — skip or assign to a project";
  }
  if (actions.length === 1 && actions[0].type === "log_email") {
    return `Log as ${actions[0].data.category || "other"}${actions[0].data.project_name ? ` → ${actions[0].data.project_name}` : ""}`;
  }

  const parts: string[] = [];
  for (const a of actions) {
    switch (a.type) {
      case "create_project":
        parts.push(`New project: "${a.data.name}" (${a.data.status})`);
        break;
      case "create_customer":
        parts.push(`New customer: ${a.data.first_name} ${a.data.last_name}`);
        break;
      case "create_subcontractor":
        parts.push(`New sub: ${a.data.company_name}`);
        break;
      case "create_quote":
        parts.push(`Quote: ${a.data.subcontractor_name} → ${a.data.project_name}${a.data.amount ? ` ($${Number(a.data.amount).toLocaleString()})` : ""}`);
        break;
      case "create_follow_up":
        parts.push(`Follow-up: ${a.data.contact_name}`);
        break;
      case "update_project_stage":
        parts.push(`Update: ${a.data.project_name} → ${a.data.new_status}`);
        break;
      case "log_email":
        parts.push(`Log → ${a.data.project_name || "general"}`);
        break;
    }
  }
  return parts.join("\n");
}

function getActionColor(actions: TriageAction[]): string {
  if (actions.some((a) => a.type === "create_project")) return "border-blue-500/50";
  if (actions.some((a) => a.type === "create_quote")) return "border-green-500/50";
  if (actions.some((a) => a.type === "create_follow_up")) return "border-orange-500/50";
  return "border-border";
}

const PROJECT_TYPES = [
  { value: "remodel", label: "Remodel" },
  { value: "addition", label: "Addition" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "new_construction", label: "New Construction" },
  { value: "other", label: "Other" },
];

const PROJECT_STATUSES = [
  { value: "lead", label: "Lead" },
  { value: "estimating", label: "Estimating" },
  { value: "proposal_sent", label: "Proposal Sent" },
  { value: "contracted", label: "Contracted" },
  { value: "in_progress", label: "In Progress" },
];

// ── Main Component ──────────────────

export function EmailTriageWizard({ items, isScanning, onComplete, onCancel }: EmailTriageWizardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, "confirmed" | "skipped">>({});
  const [overrides, setOverrides] = useState<Record<string, TriageAction[]>>({});
  const [createdProjects, setCreatedProjects] = useState<CreatedProject[]>([]);
  const [saving, setSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

  const current = items[currentIndex];
  const confirmed = items.filter((i) => decisions[i.email.id] === "confirmed");
  const skipped = items.filter((i) => decisions[i.email.id] === "skipped");
  const isLast = currentIndex >= items.length - 1;
  const waitingForMore = isLast && isScanning;

  // Build project list from AI suggestions + user-created projects
  const allProjectNames = useMemo(() => {
    const fromAI = new Set<string>();
    for (const item of items) {
      const actions = overrides[item.email.id] || item.actions;
      for (const a of actions) {
        if (!a.data) continue;
        if (a.type === "create_project" && a.data.name) fromAI.add(a.data.name as string);
        if (a.data.project_name) fromAI.add(a.data.project_name as string);
      }
    }
    for (const p of createdProjects) fromAI.add(p.name);
    return Array.from(fromAI).sort();
  }, [items, overrides, createdProjects]);

  function getActions(item: TriageItem) {
    return overrides[item.email.id] || item.actions;
  }

  function advance() {
    if (isLast && !isScanning) setShowSummary(true);
    else setCurrentIndex((i) => Math.min(i + 1, items.length - 1));
  }

  function handleConfirm() {
    if (current) setDecisions((prev) => ({ ...prev, [current.email.id]: "confirmed" }));
    setShowNewProject(false);
    setShowAssign(false);
    advance();
  }

  function handleSkip() {
    if (current) setDecisions((prev) => ({ ...prev, [current.email.id]: "skipped" }));
    setShowNewProject(false);
    setShowAssign(false);
    advance();
  }

  function handleAssignToProject(projectName: string) {
    if (!current) return;
    // Override actions to log this email under the selected project
    const existingActions = getActions(current).filter((a) => a.type !== "log_email");
    setOverrides((prev) => ({
      ...prev,
      [current.email.id]: [
        ...existingActions,
        { type: "log_email", data: { category: "other", project_name: projectName } },
      ],
    }));
    setDecisions((prev) => ({ ...prev, [current.email.id]: "confirmed" }));
    setShowAssign(false);
    advance();
  }

  function handleCreateProject(project: CreatedProject) {
    if (!current) return;
    setCreatedProjects((prev) => [...prev, project]);
    // Add create_project + log_email actions for this email
    const existingActions = getActions(current).filter(
      (a) => a.type !== "create_project" && a.type !== "log_email"
    );
    setOverrides((prev) => ({
      ...prev,
      [current.email.id]: [
        { type: "create_project", data: { name: project.name, project_type: project.project_type, status: project.status, address: project.address, city: project.city, customer_name: project.customer_name, phase: "preconstruction" } },
        ...existingActions,
        { type: "log_email", data: { category: "client_update", project_name: project.name } },
      ],
    }));
    setDecisions((prev) => ({ ...prev, [current.email.id]: "confirmed" }));
    setShowNewProject(false);
    advance();
  }

  async function handleSave() {
    setSaving(true);
    const confirmedItems = items
      .filter((i) => decisions[i.email.id] === "confirmed")
      .map((i) => ({
        ...i,
        actions: overrides[i.email.id] || i.actions,
      }));
    await onComplete(confirmedItems);
    setSaving(false);
  }

  // ── Summary view ──────────────────
  if (showSummary) {
    const allActions = confirmed.flatMap((i) => getActions(i)).filter((a) =>
      ["create_project", "create_customer", "create_subcontractor", "create_quote", "create_follow_up"].includes(a.type)
    );
    const projects = allActions.filter((a) => a.type === "create_project");
    const customers = allActions.filter((a) => a.type === "create_customer");
    const subs = allActions.filter((a) => a.type === "create_subcontractor");
    const quotes = allActions.filter((a) => a.type === "create_quote");
    const followUps = allActions.filter((a) => a.type === "create_follow_up");

    return (
      <Dialog open onOpenChange={() => onCancel()}>
        <DialogContent className="max-w-lg">
          <DialogTitle>Ready to Save</DialogTitle>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {confirmed.length} confirmed, {skipped.length} skipped out of {items.length} emails.
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { count: projects.length, label: "Projects", color: "text-blue-400" },
                { count: customers.length, label: "Customers", color: "text-purple-400" },
                { count: subs.length, label: "Subs", color: "text-orange-400" },
                { count: quotes.length, label: "Quotes", color: "text-green-400" },
              ].map((s) => (
                <div key={s.label} className="border rounded-lg p-3 text-center">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
                  <div className="text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
            {followUps.length > 0 && (
              <p className="text-sm text-muted-foreground">{followUps.length} follow-ups</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowSummary(false)} disabled={saving}>
                Back
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-2" />}
                Save All ({confirmed.length} emails)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Waiting state ──────────────────
  if (!current || (waitingForMore && decisions[current?.email?.id])) {
    return (
      <Dialog open onOpenChange={() => onCancel()}>
        <DialogContent className="max-w-md">
          <DialogTitle className="sr-only">Scanning</DialogTitle>
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <div className="text-center">
              <p className="font-medium">Scanning your emails...</p>
              <p className="text-sm text-muted-foreground mt-1">
                {items.length > 0 ? `${items.length} analyzed. Waiting for more...` : "First batch coming up..."}
              </p>
              {confirmed.length > 0 && (
                <p className="text-xs text-green-400 mt-2">{confirmed.length} confirmed so far</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Main triage view ──────────────────
  const currentActions = getActions(current);
  const isSkipType = currentActions.length === 0 ||
    (currentActions.length === 1 && (currentActions[0].type === "skip" || currentActions[0].type === "log_email"));

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between">
          <DialogTitle className="text-base">Email Triage</DialogTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="text-green-400">{confirmed.length} confirmed</span>
            <span>{skipped.length} skipped</span>
            <span className="font-medium text-foreground">{currentIndex + 1} / {items.length}{isScanning ? "+" : ""}</span>
            {isScanning && <Loader2 className="h-3 w-3 animate-spin text-amber-500" />}
          </div>
        </div>

        {/* Progress */}
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-amber-500 rounded-full transition-all"
            style={{ width: `${items.length > 0 ? ((currentIndex + 1) / items.length) * 100 : 0}%` }} />
        </div>

        {/* Email card */}
        <div className={`border-2 rounded-lg p-4 space-y-3 flex-1 min-h-0 overflow-y-auto ${getActionColor(currentActions)}`}>
          {/* Email header */}
          <div className="flex items-start gap-2">
            <div className={`p-1.5 rounded shrink-0 ${current.email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"}`}>
              {current.email.direction === "inbound"
                ? <ArrowDownLeft className="h-4 w-4 text-blue-400" />
                : <ArrowUpRight className="h-4 w-4 text-green-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{current.email.subject}</p>
              <p className="text-xs text-muted-foreground">
                {current.email.direction === "inbound" ? "From" : "To"}: {current.email.from} &lt;{current.email.fromEmail}&gt;
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(current.email.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">{current.email.direction}</Badge>
          </div>

          {/* Body preview */}
          <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground max-h-40 overflow-y-auto whitespace-pre-wrap">
            {current.email.snippet || "No preview available"}
          </div>

          {/* Attachments */}
          {current.email.attachments && current.email.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {current.email.attachments.map((att, i) => (
                <Badge key={i} variant="outline" className="text-[10px] gap-1">
                  <Paperclip className="h-3 w-3" />
                  {att.filename}
                </Badge>
              ))}
            </div>
          )}

          {/* AI Suggestion */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded p-3">
            <p className="text-xs font-medium text-amber-400 mb-1">AI Suggestion:</p>
            <p className="text-sm whitespace-pre-line">{summarizeActions(currentActions)}</p>
          </div>

          {/* Assign to project panel */}
          {showAssign && (
            <div className="border border-blue-500/30 rounded-lg p-3 space-y-2 bg-blue-500/5">
              <p className="text-xs font-medium text-blue-400">Assign to Project</p>
              <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                {allProjectNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => handleAssignToProject(name)}
                    className="text-left text-sm px-2 py-1.5 rounded hover:bg-blue-500/20 truncate"
                  >
                    {name}
                  </button>
                ))}
              </div>
              {allProjectNames.length === 0 && (
                <p className="text-xs text-muted-foreground">No projects yet. Create one first.</p>
              )}
            </div>
          )}

          {/* New project form — pre-filled from AI + email */}
          {showNewProject && (
            <NewProjectForm
              prefill={extractProjectPrefill(current)}
              onSubmit={handleCreateProject}
              onCancel={() => setShowNewProject(false)}
            />
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={handleSkip} variant="outline" size="sm">
            <X className="h-4 w-4 mr-1" />
            Skip
          </Button>

          {!showNewProject && !showAssign && (
            <>
              <Button onClick={handleConfirm} size="sm" className="bg-green-600 hover:bg-green-700">
                <Check className="h-4 w-4 mr-1" />
                {isSkipType ? "Log It" : "Confirm"}
              </Button>

              <Button onClick={() => { setShowAssign(!showAssign); setShowNewProject(false); }} variant="outline" size="sm">
                <FolderOpen className="h-4 w-4 mr-1" />
                Assign to Project
              </Button>

              <Button onClick={() => { setShowNewProject(!showNewProject); setShowAssign(false); }} variant="outline" size="sm" className="text-blue-400 border-blue-500/30">
                <Plus className="h-4 w-4 mr-1" />
                New Project
              </Button>

              {currentActions.some((a) => a.type === "create_quote") && (
                <Badge variant="secondary" className="text-[10px] bg-green-500/20 text-green-400">
                  Has quote
                </Badge>
              )}
            </>
          )}

          <Button onClick={() => setShowSummary(true)} variant="ghost" size="sm" className="text-muted-foreground ml-auto">
            Done
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Extract pre-fill from AI actions + email ──────────────────

function extractProjectPrefill(item: TriageItem): CreatedProject {
  // Check if AI already suggested a project
  const projectAction = item.actions.find((a) => a.type === "create_project");
  if (projectAction?.data) {
    return {
      name: (projectAction.data.name as string) || "",
      project_type: (projectAction.data.project_type as string) || "other",
      status: (projectAction.data.status as string) || "lead",
      address: (projectAction.data.address as string) || undefined,
      city: (projectAction.data.city as string) || undefined,
      customer_name: (projectAction.data.customer_name as string) || undefined,
    };
  }

  // Check if AI suggested a customer
  const customerAction = item.actions.find((a) => a.type === "create_customer");
  const clientName = customerAction?.data
    ? `${customerAction.data.first_name || ""} ${customerAction.data.last_name || ""}`.trim()
    : "";

  // Try to extract client name from email (if inbound, sender is likely the client)
  const fromName = item.email.direction === "inbound" ? item.email.from : "";
  const guessedClient = clientName || fromName;

  // Try to build project name from client last name + subject hints
  const lastName = guessedClient.split(/\s+/).pop() || "";
  const subjectLower = item.email.subject.toLowerCase();
  let guessedType = "other";
  if (subjectLower.includes("kitchen")) guessedType = "kitchen";
  else if (subjectLower.includes("bath")) guessedType = "bathroom";
  else if (subjectLower.includes("addition")) guessedType = "addition";
  else if (subjectLower.includes("remodel")) guessedType = "remodel";

  const typeSuffix = guessedType !== "other"
    ? guessedType.charAt(0).toUpperCase() + guessedType.slice(1)
    : "Project";

  return {
    name: lastName ? `${lastName} ${typeSuffix}` : "",
    project_type: guessedType,
    status: "lead",
    customer_name: guessedClient || undefined,
  };
}

// ── New Project Form ──────────────────

function NewProjectForm({ prefill, onSubmit, onCancel }: {
  prefill: CreatedProject;
  onSubmit: (project: CreatedProject) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(prefill.name || "");
  const [type, setType] = useState(prefill.project_type || "other");
  const [status, setStatus] = useState(prefill.status || "lead");
  const [address, setAddress] = useState(prefill.address || "");
  const [city, setCity] = useState(prefill.city || "");
  const [customerName, setCustomerName] = useState(prefill.customer_name || "");

  return (
    <div className="border border-blue-500/30 rounded-lg p-3 space-y-3 bg-blue-500/5">
      <p className="text-xs font-medium text-blue-400">Create New Project</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Label className="text-xs">Project Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smith Kitchen" className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROJECT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROJECT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Address</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street" className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">City</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="h-8 text-sm" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Client Name</Label>
          <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="First Last" className="h-8 text-sm" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => {
          if (!name.trim()) return;
          onSubmit({ name: name.trim(), project_type: type, status, address: address || undefined, city: city || undefined, customer_name: customerName || undefined });
        }} disabled={!name.trim()}>
          <Plus className="h-3 w-3 mr-1" />
          Create & Assign
        </Button>
      </div>
    </div>
  );
}

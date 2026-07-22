"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  MessageCircle,
  MapPin,
  Copy,
  Check,
} from "lucide-react";
import { updateApplication } from "@/app/(app)/hiring/actions";

export interface JobApplication {
  id: string;
  created_at: string;
  role: "coordinator" | "ai_ops";
  full_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  location: string | null;
  english_level: string | null;
  years_construction: string | null;
  years_tech: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  available_est: boolean | null;
  expected_salary: string | null;
  cover_note: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  coordinator: "Coordinator",
  ai_ops: "AI Ops",
};

const STATUSES = ["new", "reviewing", "interview", "offer", "rejected"] as const;

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  new: "default",
  reviewing: "secondary",
  interview: "secondary",
  offer: "default",
  rejected: "destructive",
};

export function ApplicationsBoard({
  applications,
  applyUrl,
}: {
  applications: JobApplication[];
  applyUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const counts = {
    all: applications.length,
    coordinator: applications.filter((a) => a.role === "coordinator").length,
    ai_ops: applications.filter((a) => a.role === "ai_ops").length,
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(applyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context) — no-op.
    }
  };

  return (
    <div className="space-y-5">
      {/* Share link */}
      <Card>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Public application link</p>
            <p className="truncate text-sm text-muted-foreground">{applyUrl}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={copyLink}
            className="shrink-0"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="coordinator">
            Coordinator ({counts.coordinator})
          </TabsTrigger>
          <TabsTrigger value="ai_ops">AI Ops ({counts.ai_ops})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <ApplicationList items={applications} />
        </TabsContent>
        <TabsContent value="coordinator">
          <ApplicationList
            items={applications.filter((a) => a.role === "coordinator")}
          />
        </TabsContent>
        <TabsContent value="ai_ops">
          <ApplicationList
            items={applications.filter((a) => a.role === "ai_ops")}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ApplicationList({ items }: { items: JobApplication[] }) {
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No applications yet.
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      {items.map((app) => (
        <ApplicationCard key={app.id} app={app} />
      ))}
    </div>
  );
}

function ApplicationCard({ app }: { app: JobApplication }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(app.status);
  const [notes, setNotes] = useState(app.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [isPending, startTransition] = useTransition();

  const appliedOn = new Date(app.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  function onStatusChange(next: string) {
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      const res = await updateApplication(app.id, { status: next });
      if (!res.success) {
        setStatus(prev);
        return;
      }
      router.refresh();
    });
  }

  async function saveNotes() {
    setSavingNotes(true);
    const res = await updateApplication(app.id, { notes });
    setSavingNotes(false);
    if (res.success) router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {app.full_name || "Unnamed applicant"}
              </span>
              <Badge variant="outline">{ROLE_LABEL[app.role] ?? app.role}</Badge>
              <Badge variant={STATUS_VARIANT[status] ?? "outline"}>
                {status}
              </Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {app.email && (
                <a
                  href={`mailto:${app.email}`}
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {app.email}
                </a>
              )}
              {app.phone && (
                <a
                  href={`tel:${app.phone}`}
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {app.phone}
                </a>
              )}
              {app.whatsapp && (
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {app.whatsapp}
                </span>
              )}
              {app.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {app.location}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-xs text-muted-foreground">{appliedOn}</span>
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
              disabled={isPending}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-amber-600 hover:underline dark:text-amber-400"
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          {expanded ? "Hide details" : "View details"}
        </button>

        {expanded && (
          <div className="space-y-3 border-t pt-3 text-sm">
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Detail label="English level" value={app.english_level} />
              <Detail
                label="Construction experience"
                value={app.years_construction}
              />
              <Detail label="Tech / AI experience" value={app.years_tech} />
              <Detail label="Expected salary" value={app.expected_salary} />
              <Detail
                label="Available EST"
                value={
                  app.available_est === null
                    ? null
                    : app.available_est
                    ? "Yes"
                    : "No"
                }
              />
              <Detail
                label="LinkedIn"
                value={app.linkedin_url}
                href={app.linkedin_url}
              />
              <Detail
                label="Portfolio"
                value={app.portfolio_url}
                href={app.portfolio_url}
              />
            </div>

            {app.cover_note && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Cover note
                </p>
                <p className="mt-1 whitespace-pre-wrap">{app.cover_note}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Internal notes
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="Notes on this applicant..."
              />
              <div className="mt-2 flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveNotes}
                  disabled={savingNotes || notes === (app.notes ?? "")}
                >
                  {savingNotes ? "Saving..." : "Save notes"}
                </Button>
                {app.reviewed_by && app.reviewed_at && (
                  <span className="text-xs text-muted-foreground">
                    Last updated by {app.reviewed_by} on{" "}
                    {new Date(app.reviewed_at).toLocaleDateString("en-US")}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  href?: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block truncate text-amber-600 hover:underline dark:text-amber-400"
        >
          {value}
        </a>
      ) : (
        <p className="mt-0.5">{value}</p>
      )}
    </div>
  );
}

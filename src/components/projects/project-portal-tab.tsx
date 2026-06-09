"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Link2,
  Copy,
  Check,
  Mail,
  Eye,
  Loader2,
  Power,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface PortalRow {
  id: string;
  token: string;
  client_name: string | null;
  client_email: string | null;
  enabled: boolean;
  last_viewed_at: string | null;
  view_count: number;
  link_sent_at: string | null;
}

interface ProjectPortalTabProps {
  projectId: string;
  projectName: string;
  userId: string;
  defaultClientName?: string;
  defaultClientEmail?: string;
}

export function ProjectPortalTab({
  projectId,
  projectName,
  userId,
  defaultClientName = "",
  defaultClientEmail = "",
}: ProjectPortalTabProps) {
  const [portal, setPortal] = useState<PortalRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(defaultClientName);
  const [email, setEmail] = useState(defaultClientEmail);
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));

  const load = useCallback(() => {
    const supabase = createClient();
    supabase
      .from("client_portal_access")
      .select("id, token, client_name, client_email, enabled, last_viewed_at, view_count, link_sent_at")
      .eq("project_id", projectId)
      .maybeSingle()
      .then(({ data }) => {
        setPortal((data as PortalRow) ?? null);
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const link = portal ? `${origin}/portal/${portal.token}` : "";

  async function createPortal() {
    if (!name.trim()) {
      alert("Add the client's name first.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("client_portal_access")
      .insert({
        project_id: projectId,
        client_name: name.trim(),
        client_email: email.trim() || null,
        created_by: userId,
      })
      .select("id, token, client_name, client_email, enabled, last_viewed_at, view_count, link_sent_at")
      .single();
    setSaving(false);
    if (error) {
      alert("Couldn't create the portal: " + error.message);
      return;
    }
    setPortal(data as PortalRow);
  }

  async function toggleEnabled() {
    if (!portal) return;
    const next = !portal.enabled;
    setPortal({ ...portal, enabled: next });
    const supabase = createClient();
    await supabase
      .from("client_portal_access")
      .update({ enabled: next, updated_at: new Date().toISOString() })
      .eq("id", portal.id);
  }

  async function markSent() {
    if (!portal) return;
    const now = new Date().toISOString();
    setPortal({ ...portal, link_sent_at: now });
    const supabase = createClient();
    await supabase
      .from("client_portal_access")
      .update({ link_sent_at: now, updated_at: now })
      .eq("id", portal.id);
  }

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    markSent();
    setTimeout(() => setCopied(false), 1800);
  }

  const mailto = portal
    ? `mailto:${portal.client_email || ""}?subject=${encodeURIComponent(
        `Your ${projectName} project portal`
      )}&body=${encodeURIComponent(
        `Hi ${portal.client_name || "there"},\n\n` +
          `Here's your private link to follow your project — schedule, payments, and the selections we need from you:\n\n` +
          `${link}\n\n` +
          `Bookmark it; it stays live through the whole job. Reply here anytime with questions.\n\n` +
          `Thanks,\nPenney Construction`
      )}`
    : "";

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading portal…
      </div>
    );
  }

  // ── No portal yet: create form ────────────────────────────
  if (!portal) {
    return (
      <div className="max-w-md">
        <div className="flex items-center gap-2 mb-1">
          <Link2 className="h-5 w-5 text-amber-500" />
          <h3 className="text-sm font-semibold">Client Portal</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Create a private link for this client. They open it with no password — the link is their key.
          You can turn it off anytime.
        </p>
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Client name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Homeowner"
              className="mt-1 w-full rounded border bg-background px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Client email (optional)</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@email.com"
              type="email"
              className="mt-1 w-full rounded border bg-background px-2.5 py-1.5 text-sm"
            />
          </div>
          <Button onClick={createPortal} disabled={saving} className="w-full gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Create portal link
          </Button>
        </div>
      </div>
    );
  }

  // ── Portal exists: link + controls ────────────────────────
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-amber-500" />
          <h3 className="text-sm font-semibold">Client Portal</h3>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full ${
            portal.enabled
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${portal.enabled ? "bg-emerald-400" : "bg-muted-foreground"}`} />
          {portal.enabled ? "Live" : "Turned off"}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        For <span className="font-medium text-foreground">{portal.client_name}</span>
        {portal.client_email ? ` · ${portal.client_email}` : ""}
      </p>

      {/* The link */}
      <div className="rounded-lg border p-3">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Private link</label>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-muted px-2.5 py-1.5 text-xs">{link}</code>
          <Button onClick={copyLink} size="sm" variant="outline" className="gap-1.5 shrink-0">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <a href={mailto} onClick={markSent}>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email to client
            </Button>
          </a>
          <a href={link} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5" /> Preview
            </Button>
          </a>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <Stat icon={<Eye className="h-3.5 w-3.5" />} label="Views" value={String(portal.view_count || 0)} />
        <Stat
          icon={<Eye className="h-3.5 w-3.5" />}
          label="Last viewed"
          value={portal.last_viewed_at ? new Date(portal.last_viewed_at).toLocaleDateString() : "Not yet"}
        />
        <Stat
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Link sent"
          value={portal.link_sent_at ? new Date(portal.link_sent_at).toLocaleDateString() : "Not yet"}
        />
      </div>

      {/* Access control */}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Access</p>
            <p className="text-xs text-muted-foreground">
              {portal.enabled ? "Client can open the link." : "Link is blocked — client sees a turned-off message."}
            </p>
          </div>
        </div>
        <Button
          onClick={toggleEnabled}
          size="sm"
          variant={portal.enabled ? "outline" : "default"}
          className="gap-1.5"
        >
          <Power className="h-3.5 w-3.5" />
          {portal.enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-center gap-1 text-muted-foreground text-[10px] uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <p className="text-sm font-medium mt-1 truncate">{value}</p>
    </div>
  );
}

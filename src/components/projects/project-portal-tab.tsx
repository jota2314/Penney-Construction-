"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Link2, Copy, Check, Mail, Eye, Loader2, Power } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PortalContentManager } from "./portal-content-manager";

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

const PORTAL_FIELDS = "id, token, client_name, client_email, enabled, last_viewed_at, view_count, link_sent_at";

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
  const linkRef = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    const supabase = createClient();
    supabase
      .from("client_portal_access")
      .select(PORTAL_FIELDS)
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
      .select(PORTAL_FIELDS)
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
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(true);
        markSent();
        setTimeout(() => setCopied(false), 1800);
      },
      // Clipboard refused (permissions, old browser): select the link so it can be copied by hand.
      () => { if (linkRef.current) window.getSelection()?.selectAllChildren(linkRef.current); },
    );
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

  const status = !portal
    ? { label: "Not set up", dot: "bg-muted-foreground", pill: "bg-muted text-muted-foreground" }
    : portal.enabled
      ? { label: "Live", dot: "bg-emerald-400", pill: "bg-emerald-500/15 text-emerald-400" }
      : { label: "Turned off", dot: "bg-muted-foreground", pill: "bg-muted text-muted-foreground" };

  return (
    <div className="space-y-4">
      {/* Header: who it's for, the link, and the switches */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link2 className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-semibold">Client portal</h3>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.pill}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </span>
            </div>
            {portal ? (
              <p className="mt-1 text-sm text-muted-foreground">
                For <span className="font-medium text-foreground">{portal.client_name}</span>
                {portal.client_email ? ` · ${portal.client_email}` : ""}
              </p>
            ) : (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                One private link where the client follows the schedule, payments, documents and selections.
                No password; you can turn it off anytime.
              </p>
            )}
          </div>
          <a href={`/portal-preview/${projectId}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Preview as client
            </Button>
          </a>
        </div>

        {portal ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code ref={linkRef} className="min-w-0 flex-1 basis-64 truncate rounded-md bg-muted px-2.5 py-2 text-xs">{link}</code>
            <Button onClick={copyLink} size="sm" variant="outline" className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <a href={mailto} onClick={markSent}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Email to client
              </Button>
            </a>
            <Button
              onClick={toggleEnabled}
              size="sm"
              variant={portal.enabled ? "ghost" : "default"}
              className={`gap-1.5 ${portal.enabled ? "text-muted-foreground" : ""}`}
              title={portal.enabled ? "The link will show a turned-off message" : "The client can open the link again"}
            >
              <Power className="h-3.5 w-3.5" />
              {portal.enabled ? "Turn off" : "Turn on"}
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-48">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Client name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Homeowner"
                className="mt-1 w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="min-w-0 flex-1 basis-56">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Client email (optional)</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@email.com"
                type="email"
                className="mt-1 w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
            <Button onClick={createPortal} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Create portal link
            </Button>
          </div>
        )}
      </section>

      <PortalContentManager
        projectId={projectId}
        userId={userId}
        portal={portal ? { enabled: portal.enabled, link_sent_at: portal.link_sent_at, last_viewed_at: portal.last_viewed_at, view_count: portal.view_count } : null}
      />
    </div>
  );
}

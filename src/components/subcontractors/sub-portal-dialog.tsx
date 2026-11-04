"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Eye, KeyRound, Loader2, Mail, MessageSquare, Power } from "lucide-react";
import {
  getSubPortalActivity,
  setSubPortalPin,
  toggleSubPortalEnabled,
  type SubInviteSendChannel,
  type SubPortalActivity,
  type SubPortalStatus,
} from "@/lib/actions/sub-portal";
import { fmtShort, fmtTime } from "@/lib/portal-kit/format";
import { AddCellField, SubInviteFlow } from "./sub-invite-flow";
import type { Subcontractor } from "@/types/database";

interface SubPortalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subcontractor: Pick<Subcontractor, "id" | "company_name" | "contact_name" | "phone" | "email">;
  /** After a PIN, cell, invite or on/off change, so a list can refresh. */
  onChanged?: () => void;
}

const LOGIN_URL = "www.penneyconstruction.build/sub";

const CHANNEL_LABEL: Record<string, string> = {
  text: "text",
  email: "email",
  copy: "copied",
  qr: "job QR",
};

/** "Oct 17 · text", "Signed up from a job QR" (a QR sign-up nobody invited), or "Never". */
export function invitedLabel(at: string | null, channel: string | null): string {
  if (!at) return channel === "qr" ? "Signed up from a job QR" : "Never";
  return channel ? `${fmtShort(at)} · ${CHANNEL_LABEL[channel] ?? channel}` : fmtShort(at);
}

/**
 * Sub portal controls for one subcontractor: who he is on the portal (last
 * real visit, check-ins by job, posts), the invites, a read-only Preview,
 * the PIN and the on/off switch. The sub signs in at /sub with cell + PIN.
 */
export function SubPortalDialog({ open, onOpenChange, subcontractor, onChanged }: SubPortalDialogProps) {
  const [activity, setActivity] = useState<SubPortalActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<SubInviteSendChannel | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let live = true;
    getSubPortalActivity(subcontractor.id).then((res) => {
      if (!live) return;
      setActivity(res.activity ?? null);
      setLoadError(res.error ?? null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [open, subcontractor.id, reloadKey]);

  const status = activity?.status ?? null;

  function setStatus(next: SubPortalStatus | null) {
    setActivity((a) => (a ? { ...a, status: next } : a));
    onChanged?.();
  }

  async function savePin() {
    setSaving(true);
    setError(null);
    const res = await setSubPortalPin(subcontractor.id, pin);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setStatus(res.status ?? null);
    setPin("");
  }

  async function toggle() {
    if (!status) return;
    setError(null);
    const res = await toggleSubPortalEnabled(subcontractor.id, !status.enabled);
    if (res.error) setError(res.error);
    if (res.status) setStatus(res.status);
  }

  const cell = activity?.cell ?? null;
  const first = subcontractor.contact_name?.trim().split(/\s+/)[0] || null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setInvite(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="truncate">Sub portal: {subcontractor.company_name}</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : loadError || !activity ? (
          <p className="text-sm text-red-500">{loadError ?? "Couldn't load this sub."}</p>
        ) : invite ? (
          <div className="min-w-0 overflow-y-auto">
            <p className="mb-3 text-sm font-medium">
              {invite === "email" ? "Email invite" : invite === "text" ? "Text invite" : "Copy the invite"}
            </p>
            <SubInviteFlow
              subId={subcontractor.id}
              channel={invite}
              onDone={() => {
                setInvite(null);
                setReloadKey((k) => k + 1);
              }}
              onChanged={setStatus}
            />
          </div>
        ) : (
          <div className="min-w-0 space-y-4 overflow-y-auto">
            {/* the login */}
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                They sign in at <span className="font-medium text-foreground">{LOGIN_URL}</span> with their
                cell {cell ? <span className="font-medium text-foreground">{cell}</span> : "(none on file)"} and a PIN.
              </p>
              {!cell && (
                <AddCellField
                  subId={subcontractor.id}
                  onSaved={() => {
                    setReloadKey((k) => k + 1);
                    onChanged?.();
                  }}
                />
              )}
            </div>

            {/* activity */}
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <Row label="Invited">{invitedLabel(status?.invited_at ?? null, status?.invite_channel ?? null)}</Row>
              <Row label="Last real visit">
                {status?.last_viewed_at
                  ? `${fmtShort(status.last_viewed_at)}, ${fmtTime(status.last_viewed_at)}`
                  : "Never opened"}
              </Row>
              <p className="text-[11px] text-muted-foreground">
                {status?.view_count ?? 0} page load{status?.view_count === 1 ? "" : "s"} in all. Page loads before
                Oct 17 include office previews.
              </p>
              <Row label="Posts, last 30 days">{activity.posts_30d}</Row>
              <Row label="Last on site">
                {activity.last_on_site
                  ? `${activity.last_on_site.project_name} · ${fmtShort(activity.last_on_site.at)}`
                  : "No check-ins yet"}
              </Row>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Visits by job, last 30 days</p>
                {activity.visits_30d.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {activity.visits_30d.map((v) => (
                      <li key={v.project_id} className="flex justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">{v.project_name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {v.days} day{v.days === 1 ? "" : "s"} · {v.posts} post{v.posts === 1 ? "" : "s"} · last{" "}
                          {fmtShort(v.last_seen_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">None yet.</p>
                )}
              </div>
            </div>

            {/* invites + preview */}
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" onClick={() => setInvite("text")} disabled={!cell} className="gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" /> Text
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setInvite("email")}
                  disabled={!cell || !activity.email}
                  className="gap-1.5"
                  title={activity.email ? undefined : "No email on file"}
                >
                  <Mail className="h-3.5 w-3.5" /> Email
                </Button>
                <Button size="sm" variant="outline" onClick={() => setInvite("copy")} disabled={!cell} className="gap-1.5">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {status?.has_pin
                  ? "He keeps his PIN unless you choose a new one."
                  : "The first invite sets a 4-digit PIN and shows it to you once."}
              </p>
              <a
                href={`/sub-preview/${subcontractor.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 transition-colors hover:border-amber-500/60"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">Preview {first ? `${first}'s` : "his"} portal</p>
                  <p className="text-xs text-muted-foreground">
                    Read only. Nothing you tap is saved, and his visit count doesn&apos;t move.
                  </p>
                </div>
                <Eye className="h-4 w-4 shrink-0 text-amber-500" />
              </a>
            </div>

            {/* PIN by hand */}
            <div className="space-y-2 rounded-lg border p-3">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {status?.has_pin ? "Reset PIN" : "Set PIN"}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="4-6 digits"
                  inputMode="numeric"
                  autoComplete="off"
                  className="font-mono tracking-widest"
                  aria-label="New PIN"
                />
                <Button
                  onClick={savePin}
                  disabled={saving || pin.length < 4 || !cell}
                  size="sm"
                  className="shrink-0 gap-1.5"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {status?.has_pin ? "Reset" : "Activate"}
                </Button>
              </div>
              {status?.has_pin && (
                <p className="text-[11px] text-muted-foreground">
                  PIN is set. Resetting replaces it, so send him the new one.
                </p>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            {/* access */}
            {status && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Access</p>
                  <p className="text-xs text-muted-foreground">
                    {status.enabled ? "Portal is live." : "Portal is turned off."}
                  </p>
                </div>
                <Button onClick={toggle} size="sm" variant={status.enabled ? "outline" : "default"} className="gap-1.5">
                  <Power className="h-3.5 w-3.5" />
                  {status.enabled ? "Turn off" : "Turn on"}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

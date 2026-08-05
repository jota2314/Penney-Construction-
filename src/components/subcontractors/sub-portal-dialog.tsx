"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, KeyRound, Loader2, Power } from "lucide-react";
import {
  getSubPortalStatus,
  setSubPortalPin,
  toggleSubPortalEnabled,
  type SubPortalStatus,
} from "@/lib/actions/sub-portal";
import type { Subcontractor } from "@/types/database";

interface SubPortalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subcontractor: Subcontractor;
}

/**
 * Sub portal controls for one subcontractor: set the PIN, copy the direct
 * link, turn access on/off. The sub signs in at /sub with phone + PIN.
 */
export function SubPortalDialog({ open, onOpenChange, subcontractor }: SubPortalDialogProps) {
  const [status, setStatus] = useState<SubPortalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "invite" | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setPin("");
    getSubPortalStatus(subcontractor.id).then((s) => {
      setStatus(s);
      setLoading(false);
    });
  }, [open, subcontractor.id]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const loginUrl = `${origin}/sub`;

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
    const res = await toggleSubPortalEnabled(subcontractor.id, !status.enabled);
    if (res.status) setStatus(res.status);
  }

  function copy(text: string, which: "link" | "invite") {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1800);
  }

  const inviteText = status
    ? `Hi ${subcontractor.contact_name || subcontractor.company_name} — you can now see your Penney Construction schedule, scope and drawings online.\n\nSign in at ${loginUrl}\nPhone: your cell number\nPIN: (sent separately)\n\nBookmark it — it stays live.`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-500" />
            Sub Portal — {subcontractor.company_name}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              They sign in at <span className="font-medium text-foreground">{loginUrl}</span> with
              their cell number ({subcontractor.phone || "no phone on file"}) and a PIN you set here.
            </p>

            {/* PIN */}
            <div className="rounded-lg border p-3 space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {status?.has_pin ? "Reset PIN" : "Set PIN"}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="4-6 digits"
                  inputMode="numeric"
                  className="font-mono tracking-widest"
                />
                <Button onClick={savePin} disabled={saving || pin.length < 4} size="sm" className="shrink-0 gap-1.5">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {status?.has_pin ? "Reset" : "Activate"}
                </Button>
              </div>
              {status?.has_pin && (
                <p className="text-[11px] text-muted-foreground">
                  PIN is set. Resetting replaces it — text the new one to the sub yourself.
                </p>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            {status && (
              <>
                {/* invite + stats */}
                <div className="rounded-lg border p-3 space-y-2">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Invite
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-muted px-2.5 py-1.5 text-xs">{loginUrl}</code>
                    <Button onClick={() => copy(loginUrl, "link")} size="sm" variant="outline" className="gap-1.5 shrink-0">
                      {copied === "link" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied === "link" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <Button
                    onClick={() => copy(inviteText, "invite")}
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                  >
                    {copied === "invite" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy invite text
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Viewed {status.view_count} time{status.view_count === 1 ? "" : "s"}
                    {status.last_viewed_at
                      ? ` · last ${new Date(status.last_viewed_at).toLocaleDateString()}`
                      : " · never opened"}
                  </p>
                </div>

                {/* access */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
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
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

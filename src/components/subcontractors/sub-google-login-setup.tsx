"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setSubGoogleEmail, type SubPortalStatus } from "@/lib/actions/sub-portal";

export function SubGoogleLoginSetup({
  subId,
  currentEmail,
  suggestedEmail,
  disabled,
  onSaved,
}: {
  subId: string;
  currentEmail: string | null;
  suggestedEmail: string | null;
  disabled: boolean;
  onSaved: (status: SubPortalStatus) => void;
}) {
  const [email, setEmail] = useState(currentEmail ?? suggestedEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await setSubGoogleEmail(subId, email);
      if (result.error || !result.status) {
        setError(result.error ?? "Couldn't save the Google login. Try again.");
        return;
      }
      onSaved(result.status);
    } catch {
      setError("Couldn't save the Google login. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2 rounded-lg border p-3">
      <label htmlFor={`sub-google-email-${subId}`} className="text-sm font-medium">Google sign-in</label>
      <p className="text-xs text-muted-foreground">
        {currentEmail
          ? `Enabled for ${currentEmail}. They choose Continue with Google at the portal.`
          : "Enter their Gmail or Google Workspace email, then enable it before sending their invitation."}
      </p>
      <Input
        id={`sub-google-email-${subId}`}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        autoComplete="off"
        placeholder="name@gmail.com"
        disabled={busy || disabled}
        required
      />
      {currentEmail && email.trim().toLowerCase() !== currentEmail && (
        <p className="text-xs text-muted-foreground">Changing the email signs out the previous Google account.</p>
      )}
      {disabled && <p className="text-xs text-muted-foreground">Turn portal access on to change their Google login.</p>}
      {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
      <Button type="submit" size="sm" disabled={busy || disabled || !email.trim() || email.trim().toLowerCase() === currentEmail} className="w-full gap-1.5">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {currentEmail ? "Save Google login" : "Enable Google login"}
      </Button>
      <p className="text-[11px] text-muted-foreground">Then use Email, Text or Copy below to share the invitation.</p>
    </form>
  );
}

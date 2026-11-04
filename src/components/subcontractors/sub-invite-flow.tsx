"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Check, Copy, Loader2, Mail, MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  inviteSubToPortal,
  previewSubInvite,
  setSubLoginPhone,
  type SubInvitePreview,
  type SubInviteResult,
  type SubInviteSendChannel,
  type SubPortalStatus,
} from "@/lib/actions/sub-portal";

/**
 * The invite steps for one sub, shared by the rollout list and the portal
 * dialog. Text and Copy run on the click (the office phone does the
 * sending); Email shows exactly what will go out and needs a second,
 * explicit Send. A PIN set by the click is shown here once and nowhere else.
 */
export function SubInviteFlow({
  subId,
  channel,
  onDone,
  onChanged,
}: {
  subId: string;
  channel: SubInviteSendChannel;
  onDone: () => void;
  /** After any write (PIN set, invite stamped), so the caller can refresh. */
  onChanged?: (status: SubPortalStatus | null) => void;
}) {
  const [preview, setPreview] = useState<SubInvitePreview | null>(null);
  const [result, setResult] = useState<SubInviteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNewPin, setConfirmNewPin] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run(newPin: boolean) {
    setBusy(true);
    setError(null);
    const res = await inviteSubToPortal(subId, { channel, newPin });
    setBusy(false);
    setConfirmNewPin(false);
    if (res.error || !res.result) {
      setError(res.error ?? "That didn't work. Try again.");
      return;
    }
    const r = res.result;
    setResult(r);
    onChanged?.(r.status);
    if (r.channel === "text" && isTouchDevice()) {
      // On a phone the composer opens straight away; the button stays as a fallback.
      window.location.href = r.sms_href;
    }
    if (r.channel === "copy") {
      navigator.clipboard?.writeText(r.text).then(() => setCopied(true), () => {});
    }
  }

  // Load what will be sent. Text and Copy then run straight away; Email
  // waits on the preview for its explicit Send.
  useEffect(() => {
    let live = true;
    previewSubInvite(subId).then((res) => {
      if (!live) return;
      if (res.error || !res.preview) {
        setError(res.error ?? "Couldn't load this sub.");
        return;
      }
      setPreview(res.preview);
      if (channel !== "email" && !res.preview.problems.length) void run(false);
    });
    return () => {
      live = false;
    };
    // run() is stable for this sub and channel; re-running on every render would re-invite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subId, channel]);

  function copyText(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => setError("Couldn't copy. Select the text and copy it yourself."),
    );
  }

  if (!preview) {
    return error ? (
      <FlowError text={error} onDone={onDone} />
    ) : (
      <Working text="Loading…" />
    );
  }

  if (preview.problems.length) {
    return (
      <div className="space-y-3">
        {preview.problems.map((p) => (
          <p key={p} className="text-sm text-red-500">{p}</p>
        ))}
        <Button variant="outline" onClick={onDone} className="w-full">Close</Button>
      </div>
    );
  }

  // ── Email: the preview and the explicit Send
  if (channel === "email" && !result) {
    const willSetPin = !preview.has_pin && !(preview.test_mode && !preview.is_test_sub);
    return (
      <div className="space-y-3">
        {!preview.email ? (
          <p className="text-sm text-red-500">There&apos;s no email on file for {preview.company_name}.</p>
        ) : (
          <>
            <p className="text-sm">
              Sends from your Gmail to <span className="font-medium">{preview.email}</span>.
              {willSetPin ? " It sets his first PIN and puts it in the email." : " He keeps the PIN he has."}
            </p>
            {preview.test_mode && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                Notifications test mode is on: this goes to jbetancur@ only.
                {preview.is_test_sub ? "" : ` ${preview.company_name}'s login and invite date won't change.`}
              </p>
            )}
            <div className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              <p className="mb-2 font-medium">{preview.email_subject}</p>
              {preview.email_body}
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button onClick={() => run(false)} disabled={busy} className="gap-1.5 sm:flex-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send email
              </Button>
              <Button variant="outline" onClick={onDone} disabled={busy} className="sm:flex-1">Cancel</Button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!result) {
    return error ? <FlowError text={error} onDone={onDone} /> : <Working text="Setting up…" />;
  }

  // ── Done: the PIN once, then the way out
  return (
    <div className="space-y-3">
      {result.pin ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <p className="text-xs text-muted-foreground">New PIN. Shown once; it&apos;s in the {result.channel === "email" ? "email" : "text"}.</p>
          <p className="font-mono text-2xl font-semibold tracking-[0.3em]">{result.pin}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {result.channel === "email" && result.test_mode && !preview.is_test_sub
            ? "No PIN was set."
            : "He keeps the PIN he already has."}
        </p>
      )}

      {result.note && <p className="text-sm">{result.note}</p>}

      {result.channel === "text" && (
        <>
          <a
            href={result.sms_href}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <MessageSquare className="h-4 w-4" /> Open the text to {result.cell}
          </a>
          <DesktopQr href={result.sms_href} />
        </>
      )}

      {(result.channel === "copy" || result.channel === "text") && (
        <div className="space-y-2">
          <textarea
            readOnly
            value={result.text}
            rows={6}
            className="w-full rounded-md border bg-muted/40 p-2 text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button variant="outline" onClick={() => copyText(result.text)} className="w-full gap-1.5">
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy the text"}
          </Button>
        </div>
      )}

      {result.stamped && (
        <p className="text-xs text-muted-foreground">Marked invited by {result.channel} today.</p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!result.pin && !(result.channel === "email" && result.test_mode && !preview.is_test_sub) && (
        confirmNewPin ? (
          <div className="space-y-2 rounded-md border border-red-500/30 p-3">
            <p className="text-sm">His old PIN stops working. Send him the new one right away.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => run(true)} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Give him a new PIN
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmNewPin(false)} disabled={busy} className="flex-1">
                Keep his PIN
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmNewPin(true)} className="text-muted-foreground">
            Forgot his PIN? Give him a new one
          </Button>
        )
      )}

      <Button variant="outline" onClick={onDone} className="w-full">Done</Button>
    </div>
  );
}

function Working({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {text}
    </div>
  );
}

function FlowError({ text, onDone }: { text: string; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-red-500">{text}</p>
      <Button variant="outline" onClick={onDone} className="w-full">Close</Button>
    </div>
  );
}

function isTouchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

/**
 * On a computer the sms: link can't send, so show it as a QR: scan it with
 * the office phone and the text opens there, ready to send.
 */
function DesktopQr({ href }: { href: string }) {
  // Only ever mounted after a click, so reading the pointer here can't
  // disagree with a server render.
  const [desktop] = useState(() => !isTouchDevice());
  const path = useMemo(() => {
    if (!desktop) return null;
    const qr = qrcode(0, "L");
    qr.addData(href);
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
    return { d, size: count + quiet * 2 };
  }, [desktop, href]);

  if (!path) return null;
  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <svg
        viewBox={`0 0 ${path.size} ${path.size}`}
        className="h-36 w-36 shrink-0"
        shapeRendering="crispEdges"
        role="img"
        aria-label="QR code that opens the invite text on a phone"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width={path.size} height={path.size} fill="#fff" />
        <path d={path.d} fill="#000" />
      </svg>
      <p className="text-xs text-muted-foreground">
        On a computer? Point your phone&apos;s camera here and the text opens on your phone, ready to send.
      </p>
    </div>
  );
}

/**
 * Inline "Add cell" box. The cell is the portal login: at least 10 digits,
 * and no other sub may sign in with it (checked on the server).
 */
export function AddCellField({
  subId,
  onSaved,
  placeholder = "Add cell",
}: {
  subId: string;
  onSaved: (phone: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

  async function save() {
    setBusy(true);
    setError(null);
    setWarning(null);
    const res = await setSubLoginPhone(subId, value);
    setBusy(false);
    if (res.error || !res.phone) {
      setError(res.error ?? "Couldn't save the cell.");
      return;
    }
    setValue("");
    if (res.warning) setWarning(res.warning);
    onSaved(res.phone);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && digits.length >= 10 && !busy) void save();
          }}
          placeholder={placeholder}
          inputMode="tel"
          autoComplete="off"
          className="h-8 min-w-0 text-sm"
          aria-label="Cell number"
        />
        <Button size="sm" onClick={save} disabled={busy || digits.length < 10} className="h-8 shrink-0 gap-1">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
      {value && digits.length < 10 && <p className="text-[11px] text-muted-foreground">{10 - digits.length} more digits</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      {warning && <p className="text-[11px] text-amber-600">{warning}</p>}
    </div>
  );
}

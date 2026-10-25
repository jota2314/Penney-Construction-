"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { PortalHeader, PortalNotice, PortalTheme } from "@/components/portal-kit";
import { telHref } from "@/lib/portal-kit/format";

const OFFICE_PHONE = "978-621-4387";
const PHONE_KEY = "sub_portal_phone";

// The phone number this phone signed in with last time. Read through
// useSyncExternalStore so the server render (empty) and the first client
// render agree, and nothing is set inside an effect.
const noSubscribe = () => () => {};
function readSavedPhone(): string {
  try {
    return window.localStorage.getItem(PHONE_KEY) ?? "";
  } catch {
    return ""; // private mode / storage blocked: just start empty
  }
}

/** Where to go after signing in: a /sub/portal deep link (a QR's ?job=…) if one came along. */
function nextPath(): string {
  try {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && (next === "/sub/portal" || next.startsWith("/sub/portal?"))) return next;
  } catch {
    /* fall through */
  }
  return "/sub/portal";
}

const INPUT =
  "mt-1 block min-h-[52px] w-full rounded-xl border border-[var(--line)] bg-white px-4 text-[16px] text-[var(--ink)] placeholder:text-[#8A928E]";

/**
 * The /sub sign-in form (page.tsx renders it with the "Watch how" link).
 * Phone + 4-digit PIN (lockbox-code simple); success sets the httpOnly
 * portal cookie and lands on /sub/portal.
 *
 * The PIN box is deliberately NOT a normal password field. It used to be
 * `type="password"` with no autocomplete hint, so browsers and password
 * managers happily autofilled a saved website password into it — and because
 * the box strips every non-digit, whatever survived got submitted silently
 * behind dots the sub could not read. That produced "my PIN doesn't work"
 * with a PIN that was provably correct (John Cosentino, 8/13 and 8/26).
 * Hence: one-time-code autocomplete, the manager opt-out attributes, and a
 * Show toggle so you can always see what is actually in the box.
 *
 * The look is the portal's daylight skin (light paper, dark ink, Manrope,
 * 16px inputs so iOS doesn't zoom, a 52px Sign in button).
 */
export function SubLogin({ loomUrl }: { loomUrl: string | null }) {
  const router = useRouter();
  // Subs sign in from the same phone every time — remember the number so the
  // only thing they ever type is four digits. What he types replaces it.
  const savedPhone = useSyncExternalStore(noSubscribe, readSavedPhone, () => "");
  const [typedPhone, setTypedPhone] = useState<string | null>(null);
  const phone = typedPhone ?? savedPhone;
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sub-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, pin }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Sign-in failed. Try again.");
        setPin("");
        setShowPin(false);
        setBusy(false);
        return;
      }
      try {
        window.localStorage.setItem(PHONE_KEY, phone);
      } catch {
        /* nothing to do — remembering the number is a convenience only */
      }
      router.replace(nextPath());
    } catch {
      setError("Sign-in failed. Check your signal and try again.");
      setBusy(false);
    }
  }

  return (
    <PortalTheme variant="field" className="flex flex-col">
      <PortalHeader subtitle="Penney Construction" title="Sub portal" />

      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-6">
        <h1 className="text-[26px] font-extrabold leading-tight">Sign in</h1>
        <p className="mt-1.5 text-[16px] text-[var(--muted)]">
          Your jobs, dates, drawings and daily photos with Penney, in one place.
        </p>

        <form onSubmit={submit} className="card mt-5 space-y-5 p-4">
          <label className="block">
            <span className="label">Cell phone number</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              name="phone"
              data-lpignore="true"
              data-1p-ignore
              value={phone}
              onChange={(e) => setTypedPhone(e.target.value)}
              placeholder="781-555-0100"
              className={INPUT}
            />
          </label>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="sub-portal-pin" className="label">
                PIN
              </label>
              <button
                type="button"
                onClick={() => setShowPin((s) => !s)}
                aria-pressed={showPin}
                className="-my-2 -mr-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-[15px] font-bold text-[var(--accent-dark)] underline"
              >
                {showPin ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="sub-portal-pin"
              // Not type="password": see the note on this component. A saved
              // website password autofilled here is invisible behind the dots
              // and silently fails the login.
              type={showPin ? "text" : "password"}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              name="sub-portal-pin"
              data-lpignore="true"
              data-1p-ignore
              data-bwignore
              data-form-type="other"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className={`${INPUT} tracking-[0.4em]`}
            />
            <p className="mt-1.5 text-[15px] text-[var(--muted)]">
              4 digits from the office. Tap Show to check what you typed.
            </p>
          </div>

          <PortalNotice notice={error ? { tone: "error", text: error } : null} />

          <button type="submit" disabled={busy || !phone || pin.length < 4} className="btn btn-primary btn-lg btn-block">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-6 space-y-3 text-center">
          <p className="text-[17px] font-bold">No PIN? Scan the sign at the job.</p>
          {loomUrl && (
            <a href={loomUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-block">
              Watch how (1 min)
            </a>
          )}
          <a href={telHref(OFFICE_PHONE)} className="btn btn-ghost btn-block">
            Call the office · {OFFICE_PHONE}
          </a>
        </div>
      </main>
    </PortalTheme>
  );
}

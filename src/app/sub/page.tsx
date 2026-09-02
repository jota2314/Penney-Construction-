"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const DISPLAY = { fontFamily: "var(--font-archivo), sans-serif" } as const;
const MONO = { fontFamily: "var(--font-plex-mono), monospace" } as const;

const OFFICE_PHONE = "978-621-4387";
const PHONE_KEY = "sub_portal_phone";

/**
 * /sub — subcontractor sign-in. Phone + 4-digit PIN (lockbox-code simple);
 * success sets the httpOnly portal cookie and lands on /sub/portal.
 *
 * The PIN box is deliberately NOT a normal password field. It used to be
 * `type="password"` with no autocomplete hint, so browsers and password
 * managers happily autofilled a saved website password into it — and because
 * the box strips every non-digit, whatever survived got submitted silently
 * behind dots the sub could not read. That produced "my PIN doesn't work"
 * with a PIN that was provably correct (John Cosentino, 8/13 and 8/26).
 * Hence: one-time-code autocomplete, the manager opt-out attributes, and a
 * Show toggle so you can always see what is actually in the box.
 */
export default function SubLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subs sign in from the same phone every time — remember the number so the
  // only thing they ever type is four digits.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PHONE_KEY);
      if (saved) setPhone(saved);
    } catch {
      /* private mode / storage blocked — just start empty */
    }
  }, []);

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
      router.replace("/sub/portal");
    } catch {
      setError("Sign-in failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#0b0a08] text-stone-200 flex flex-col"
      style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(245,158,11,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 80% -20%, rgba(217,119,6,.24), transparent 55%)" }}
      />

      <main className="relative flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3">
            <span className="h-[3px] w-7 bg-amber-500" />
            <p className="text-[10px] tracking-[0.4em] uppercase text-amber-500/90" style={MONO}>
              Penney Construction
            </p>
          </div>
          <h1
            className="mt-4 text-[2rem] leading-tight font-extrabold uppercase text-stone-100"
            style={DISPLAY}
          >
            Subcontractor Portal
          </h1>
          <p className="mt-2 text-[13px] text-stone-500">
            Your schedule, awarded work, billing, drawings and daily log — all in one place.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>
                Phone number
              </label>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                name="phone"
                data-lpignore="true"
                data-1p-ignore
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="781-555-0100"
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-[16px] text-stone-100 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <label className="text-[10px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>
                  PIN
                </label>
                <button
                  type="button"
                  onClick={() => setShowPin((s) => !s)}
                  className="text-[10px] uppercase tracking-[0.24em] text-amber-500/90 hover:text-amber-400"
                  style={MONO}
                >
                  {showPin ? "Hide" : "Show"}
                </button>
              </div>
              <input
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
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-[16px] tracking-[0.5em] text-stone-100 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
                style={MONO}
              />
              <p className="mt-1.5 text-[11px] text-stone-600">
                4 digits from the office. Tap Show if you want to check what you typed.
              </p>
            </div>

            {error && <p className="text-[13px] text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy || !phone || pin.length < 4}
              className="w-full rounded-xl bg-amber-500 py-3.5 text-[14px] font-semibold uppercase tracking-[0.12em] text-stone-950 transition-opacity disabled:opacity-40"
              style={DISPLAY}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-center text-[12px] text-stone-600">
            No PIN yet? Call the office at{" "}
            <a href={`tel:${OFFICE_PHONE}`} className="text-stone-400 underline underline-offset-2">
              {OFFICE_PHONE}
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

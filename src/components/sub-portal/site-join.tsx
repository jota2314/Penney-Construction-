"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HardHat, Loader2 } from "lucide-react";
import { DISPLAY, MONO, OFFICE_PHONE, Shell, Skeleton, btnGhost, btnPrimary, inputCls } from "./ui";

const PHONE_KEY = "sub_portal_phone";

type SiteInfo = {
  project: { name: string; number: string; town: string | null; open: boolean };
  signedIn: boolean;
  company: string | null;
  team: boolean;
};

const TRADES: [string, string][] = [
  ["plumbing", "Plumbing"],
  ["electrical", "Electrical"],
  ["hvac", "HVAC"],
  ["heating", "Heating"],
  ["tile", "Tile"],
  ["flooring", "Flooring"],
  ["painting", "Painting"],
  ["drywall", "Drywall"],
  ["plaster", "Plaster"],
  ["insulation", "Insulation"],
  ["framing", "Framing"],
  ["finish_carpentry", "Finish carpentry"],
  ["roofing", "Roofing"],
  ["siding", "Siding"],
  ["gutters", "Gutters"],
  ["windows", "Windows & doors"],
  ["masonry", "Masonry"],
  ["concrete", "Concrete"],
  ["excavation", "Excavation"],
  ["demolition", "Demolition"],
  ["landscaping", "Landscaping"],
];

// Same anti-autofill set as the /sub sign-in: a saved website password
// autofilled into a digits-only box fails silently behind the dots.
const PIN_INPUT_PROPS = {
  inputMode: "numeric" as const,
  pattern: "[0-9]*",
  autoComplete: "one-time-code",
  "data-lpignore": "true",
  "data-1p-ignore": true,
  "data-bwignore": true,
  "data-form-type": "other",
};

const labelCls = "text-[10px] uppercase tracking-[0.24em] text-stone-500";

/**
 * /sub/j/{code} — what a sub sees after scanning a job's site QR.
 * Signed in already → straight onto that job's log. Otherwise one short
 * form: first time (sign up, pick a PIN) or "I have a PIN". Either way it
 * ends on /sub/portal with the job open, ready to clock in and post photos.
 */
export function SiteJoin({ code }: { code: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [asSub, setAsSub] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [trade, setTrade] = useState("");
  const [otherTrade, setOtherTrade] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [website, setWebsite] = useState("");

  const openJob = (projectId: string) => router.replace(`/sub/portal?job=${encodeURIComponent(projectId)}`);

  const rememberPhone = () => {
    try {
      window.localStorage.setItem(PHONE_KEY, phone);
    } catch {
      /* convenience only */
    }
  };

  async function join(): Promise<boolean> {
    const res = await fetch("/api/sub-portal/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", code }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.projectId) {
      setError(d.error || "Couldn't open the job. Try again.");
      return false;
    }
    openJob(d.projectId);
    return true;
  }

  useEffect(() => {
    // A phone that has signed in before only needs four digits.
    try {
      const saved = window.localStorage.getItem(PHONE_KEY);
      if (saved) {
        setPhone(saved);
        setMode("signin");
      }
    } catch {
      /* storage blocked — start on sign up */
    }

    fetch(`/api/sub-portal/site?code=${encodeURIComponent(code)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setFatal(d.error || "This QR code isn't active. Call the Penney office.");
          return;
        }
        setInfo(d);
      })
      .catch(() => setFatal("We couldn't load this job. Check your signal and scan again."));
  }, [code]);

  // Already signed in on this phone: no form, straight to the job.
  const autoJoin = !!info?.signedIn && info.project.open && (!info.team || asSub);
  useEffect(() => {
    // join() is idempotent (a second call finds the sub already on the job),
    // so a dev double-run is harmless.
    if (autoJoin) void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin]);

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sub-portal/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "signup",
        code,
        name,
        company,
        trade: trade === "other" ? otherTrade : trade,
        phone,
        email,
        pin,
        website,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(d.error || "Sign-up didn't go through. Try again.");
      if (d.hasLogin) {
        setMode("signin");
        setPin("");
      }
      return;
    }
    rememberPhone();
    openJob(d.projectId);
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sub-portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, pin }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setPin("");
      setShowPin(false);
      setError(d.error || "Sign-in failed. Try again.");
      return;
    }
    rememberPhone();
    if (!(await join())) setBusy(false);
  }

  const pinField = (
    <div>
      <div className="flex items-baseline justify-between">
        <label className={labelCls} style={MONO}>
          {mode === "signup" ? "Pick a 4-digit PIN" : "PIN"}
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
        {...PIN_INPUT_PROPS}
        type={showPin ? "text" : "password"}
        maxLength={mode === "signup" ? 4 : 6}
        name="sub-portal-pin"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        placeholder="••••"
        className={`mt-1.5 ${inputCls} tracking-[0.5em]`}
        style={MONO}
      />
      {mode === "signup" && (
        <p className="mt-1.5 text-[11px] text-stone-600">You&apos;ll sign in with your cell number and this PIN.</p>
      )}
    </div>
  );

  const phoneField = (
    <div>
      <label className={labelCls} style={MONO}>
        Cell number
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
        className={`mt-1.5 ${inputCls}`}
      />
    </div>
  );

  return (
    <Shell>
      <main className="mx-auto w-full max-w-sm px-6 pb-16 pt-10">
        <div className="flex items-center gap-3">
          <span className="h-[3px] w-7 bg-amber-500" />
          <p className="text-[10px] uppercase tracking-[0.4em] text-amber-500/90" style={MONO}>
            Penney Construction
          </p>
        </div>

        {fatal ? (
          <>
            <h1 className="mt-4 text-[1.6rem] font-extrabold uppercase leading-tight text-stone-100" style={DISPLAY}>
              Job check-in
            </h1>
            <p className="mt-4 text-[14px] text-red-300">{fatal}</p>
          </>
        ) : !info ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-6 h-48" />
          </div>
        ) : (
          <>
            <h1 className="mt-4 text-[1.7rem] font-extrabold uppercase leading-[1.1] text-stone-100" style={DISPLAY}>
              {info.project.name}
            </h1>
            <p className="mt-1.5 text-[12px] text-stone-500" style={MONO}>
              {info.project.number}
              {info.project.town ? ` · ${info.project.town}` : ""}
            </p>

            {!info.project.open ? (
              <p className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-3 text-[13px] text-amber-200">
                This job isn&apos;t open for check-in right now. Call the office if you&apos;re working here.
              </p>
            ) : info.team && !asSub ? (
              <div className="mt-6 space-y-3">
                <p className="text-[14px] text-stone-300">
                  This phone is signed in to the Penney team app. Clock in and post photos from there.
                </p>
                <a href="/crew" className={`${btnPrimary} w-full`}>
                  <HardHat className="h-4 w-4" />
                  Open the Penney app
                </a>
                <button type="button" onClick={() => setAsSub(true)} className="w-full text-center text-[12px] text-stone-500 underline underline-offset-2">
                  I&apos;m a subcontractor
                </button>
              </div>
            ) : autoJoin ? (
              <div className="mt-8 flex items-center gap-3 text-[14px] text-stone-300">
                {error ? (
                  <span className="text-red-300">{error}</span>
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                    Opening the job{info.company ? ` for ${info.company}` : ""}…
                  </>
                )}
              </div>
            ) : (
              <>
                <p className="mt-4 text-[13px] text-stone-400">
                  Clock in, post photos, and see the drawings for this job.
                </p>

                <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                  {(
                    [
                      ["signup", "First time"],
                      ["signin", "I have a PIN"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMode(m);
                        setError(null);
                        setPin("");
                      }}
                      className={`rounded-lg py-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                        mode === m ? "bg-amber-500 text-stone-950" : "text-stone-400"
                      }`}
                      style={DISPLAY}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {mode === "signup" ? (
                  <form onSubmit={signUp} className="mt-6 space-y-4">
                    <div>
                      <label className={labelCls} style={MONO}>
                        Your name
                      </label>
                      <input
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="First and last"
                        className={`mt-1.5 ${inputCls}`}
                      />
                    </div>
                    <div>
                      <label className={labelCls} style={MONO}>
                        Company
                      </label>
                      <input
                        autoComplete="organization"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="Leave blank if it's just you"
                        className={`mt-1.5 ${inputCls}`}
                      />
                    </div>
                    <div>
                      <label className={labelCls} style={MONO}>
                        Trade
                      </label>
                      <select
                        value={trade}
                        onChange={(e) => setTrade(e.target.value)}
                        className={`mt-1.5 ${inputCls} appearance-none`}
                      >
                        <option value="">Pick one</option>
                        {TRADES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                        <option value="other">Something else</option>
                      </select>
                      {trade === "other" && (
                        <input
                          value={otherTrade}
                          onChange={(e) => setOtherTrade(e.target.value)}
                          placeholder="What do you do?"
                          className={`mt-2 ${inputCls}`}
                        />
                      )}
                    </div>
                    {phoneField}
                    <div>
                      <label className={labelCls} style={MONO}>
                        Email <span className="normal-case tracking-normal text-stone-600">(optional)</span>
                      </label>
                      <input
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={`mt-1.5 ${inputCls}`}
                      />
                    </div>
                    {pinField}
                    {/* Hidden from people; bots fill it and get turned away. */}
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      aria-hidden="true"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      className="absolute -left-[9999px] h-0 w-0 opacity-0"
                    />

                    {error && <p className="text-[13px] text-red-400">{error}</p>}

                    <button
                      type="submit"
                      disabled={busy || name.trim().length < 2 || !phone || pin.length !== 4}
                      className={`${btnPrimary} w-full py-3.5`}
                    >
                      {busy ? "Signing you up…" : "Sign up & open the job"}
                    </button>
                    <p className="text-center text-[11px] text-stone-600">
                      Your photos and notes go to the Penney office and this job&apos;s log.
                    </p>
                  </form>
                ) : (
                  <form onSubmit={signIn} className="mt-6 space-y-4">
                    {phoneField}
                    {pinField}
                    {error && <p className="text-[13px] text-red-400">{error}</p>}
                    <button type="submit" disabled={busy || !phone || pin.length < 4} className={`${btnPrimary} w-full py-3.5`}>
                      {busy ? "Signing in…" : "Sign in & open the job"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("signup");
                        setError(null);
                      }}
                      className={`${btnGhost} w-full`}
                    >
                      First time here? Sign up
                    </button>
                  </form>
                )}
              </>
            )}
          </>
        )}

        <p className="mt-10 text-center text-[12px] text-stone-600">
          Questions? Call the office at{" "}
          <a href={`tel:${OFFICE_PHONE}`} className="text-stone-400 underline underline-offset-2">
            {OFFICE_PHONE}
          </a>
        </p>
      </main>
    </Shell>
  );
}

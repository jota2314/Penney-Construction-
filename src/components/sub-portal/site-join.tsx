"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { HeaderAction, PortalHeader, PortalNotice, PortalTheme, type PortalNoticeValue } from "@/components/portal-kit";
import { telHref } from "@/lib/portal-kit/format";

const PHONE_KEY = "sub_portal_phone";
const OFFICE_PHONE = "978-621-4387";

type SiteInfo = {
  project: { name: string; number: string; town: string | null; open: boolean };
  signedIn: boolean;
  company: string | null;
  /** Signed in to the Penney team app in this browser. */
  team: boolean;
  /** …as office staff (not a field login): sub check-in is refused here. */
  staff: boolean;
  loomUrl: string | null;
};

/** "His company is already set up": the sign-up made nothing new. */
type KnownCompany = { company: string; firstName: string | null; hasLogin: boolean; sameFirstName: boolean };

type Suggestion = { name: string; onJob: boolean };

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

const inputCls =
  "mt-1.5 block min-h-[52px] w-full rounded-xl border border-[var(--line)] bg-white px-4 text-[16px] text-[var(--ink)] placeholder:text-[#8A928D] focus:border-[var(--accent-dark)] focus:outline-none";

/** Only ever follow a redirect back into the sub portal. */
function portalPath(redirect: unknown, projectId: string): string {
  return typeof redirect === "string" && redirect.startsWith("/sub/portal")
    ? redirect
    : `/sub/portal?job=${encodeURIComponent(projectId)}&compose=1`;
}

/**
 * /sub/j/{code} — what a sub sees after scanning a job's site sign.
 * Signed in already → checked in and straight onto that job's composer.
 * Otherwise one short form: first time (sign up, pick a PIN) or "I have a
 * PIN". A worker whose company is already set up gets told who to ask
 * instead of a second login. Light field look from the portal kit.
 */
export function SiteJoin({ code }: { code: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [asSub, setAsSub] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PortalNoticeValue | null>(null);
  const [known, setKnown] = useState<KnownCompany | null>(null);

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [companyFocused, setCompanyFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [trade, setTrade] = useState("");
  const [otherTrade, setOtherTrade] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [website, setWebsite] = useState("");

  const fail = (text: string) => setNotice({ tone: "error", text });

  const openJob = (redirect: unknown, projectId: string) => router.replace(portalPath(redirect, projectId));

  const rememberPhone = () => {
    try {
      window.localStorage.setItem(PHONE_KEY, phone);
    } catch {
      /* convenience only */
    }
  };

  async function arrive(): Promise<boolean> {
    try {
      const res = await fetch("/api/sub-portal/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "arrive", code }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // The cookie ran out (or this is Safari's first scan): sign in once.
        setInfo((i) => (i ? { ...i, signedIn: false } : i));
        setMode("signin");
        setNotice({ tone: "info", text: "Sign in with your cell number and PIN." });
        return false;
      }
      if (!res.ok || !d.projectId) {
        fail(d.error || "Couldn't check you in. Try again.");
        return false;
      }
      openJob(d.redirect, d.projectId);
      return true;
    } catch {
      fail("No signal. Try again in a moment.");
      return false;
    }
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
  const autoArrive = !!info?.signedIn && info.project.open && !info.staff && (!info.team || asSub);
  const arrivedRef = useRef(false);
  useEffect(() => {
    // One scan, one check-in, even when dev strict mode runs effects twice.
    if (!autoArrive || arrivedRef.current) return;
    arrivedRef.current = true;
    void arrive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoArrive]);

  // Company suggestions as he types: subs on this job first, then the directory.
  const companyQuery = company.trim();
  useEffect(() => {
    if (mode !== "signup" || companyQuery.length < 2) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/sub-portal/site?code=${encodeURIComponent(code)}&q=${encodeURIComponent(companyQuery)}`, {
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : { companies: [] }))
        .then((d: { companies?: Suggestion[] }) => setSuggestions(Array.isArray(d.companies) ? d.companies : []))
        .catch(() => {
          /* aborted or offline: no suggestions, he can still type it */
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [code, companyQuery, mode]);

  const visibleSuggestions = companyFocused
    ? suggestions.filter((s) => s.name.trim().toLowerCase() !== companyQuery.toLowerCase())
    : [];

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
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
        fail(d.error || "Sign-up didn't go through. Try again.");
        if (d.hasLogin) {
          setMode("signin");
          setPin("");
        }
        return;
      }
      if (d.known) {
        setBusy(false);
        setPin("");
        setKnown(d.known as KnownCompany);
        return;
      }
      rememberPhone();
      openJob(d.redirect, d.projectId);
    } catch {
      setBusy(false);
      fail("No signal. Try again in a moment.");
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
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
        fail(d.error || "Sign-in failed. Try again.");
        return;
      }
      rememberPhone();
      if (!(await arrive())) setBusy(false);
    } catch {
      setBusy(false);
      fail("No signal. Try again in a moment.");
    }
  }

  const switchMode = (m: "signup" | "signin") => {
    setMode(m);
    setNotice(null);
    setPin("");
    setShowPin(false);
  };

  const pinField = (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="site-pin" className="label">
          {mode === "signup" ? "Pick a 4-digit PIN" : "PIN"}
        </label>
        <button
          type="button"
          onClick={() => setShowPin((s) => !s)}
          className="-my-2 inline-flex min-h-[44px] items-center px-2 text-[15px] font-bold text-[var(--accent-dark)] underline underline-offset-2"
        >
          {showPin ? "Hide" : "Show"}
        </button>
      </div>
      <input
        id="site-pin"
        {...PIN_INPUT_PROPS}
        // Not a plain password box: see the note on /sub. A saved website
        // password autofilled here hides behind the dots and fails silently.
        type={showPin ? "text" : "password"}
        maxLength={mode === "signup" ? 4 : 6}
        name="sub-portal-pin"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        placeholder="••••"
        className={`${inputCls} tracking-[0.5em]`}
      />
      <p className="mt-1.5 text-[14px] text-[var(--muted)]">
        {mode === "signup"
          ? "You'll sign in with your cell number and this PIN."
          : "Tap Show to check what you typed."}
      </p>
    </div>
  );

  const phoneField = (
    <div>
      <label htmlFor="site-phone" className="label">
        Cell number
      </label>
      <input
        id="site-phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        name="phone"
        data-lpignore="true"
        data-1p-ignore
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="781-555-0100"
        className={inputCls}
      />
    </div>
  );

  const callButton = (
    <a href={telHref(OFFICE_PHONE)} className="btn btn-primary btn-lg btn-block">
      Call the office
    </a>
  );

  let content: ReactNode;
  if (fatal) {
    content = (
      <Card>
        {/* The header already says "Job check-in"; the heading stays for screen readers only. */}
        <h1 className="sr-only">Job check-in</h1>
        <p className="text-[16px] text-[var(--muted)]">{fatal}</p>
        <div className="mt-5">{callButton}</div>
      </Card>
    );
  } else if (!info) {
    content = (
      <Card>
        <p className="text-[16px] font-semibold text-[var(--muted)]">Loading the job…</p>
      </Card>
    );
  } else if (!info.project.open) {
    content = (
      <Card>
        <p className="text-[16px]">This job isn&apos;t open for check-in right now. Call the office if you&apos;re working here.</p>
        <div className="mt-5">{callButton}</div>
      </Card>
    );
  } else if (info.staff) {
    content = (
      <Card>
        <p className="text-[16px] font-bold">This browser is signed in to the Penney app as office staff.</p>
        <p className="mt-2 text-[16px] text-[var(--muted)]">
          Sub check-in is off here, so nothing gets saved under a sub&apos;s name. To see what a sub sees, open them in
          Subcontractors and use Preview.
        </p>
        <a href="/subcontractors" className="btn btn-primary btn-lg btn-block mt-5">
          Open Subcontractors
        </a>
      </Card>
    );
  } else if (info.team && !asSub) {
    content = (
      <Card>
        <p className="text-[16px]">This phone is signed in to the Penney team app. Post your photos from there.</p>
        <a href="/crew" className="btn btn-primary btn-lg btn-block mt-5">
          Open the Penney app
        </a>
        <button type="button" onClick={() => setAsSub(true)} className="btn btn-ghost btn-lg btn-block mt-3">
          I&apos;m a subcontractor
        </button>
      </Card>
    );
  } else if (autoArrive) {
    content = (
      <Card>
        {notice ? (
          <>
            <PortalNotice notice={notice} />
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                void arrive();
              }}
              className="btn btn-primary btn-lg btn-block mt-4"
            >
              Try again
            </button>
          </>
        ) : (
          <p className="text-[16px] font-semibold">
            Checking you in{info.company ? ` for ${info.company}` : ""}…
          </p>
        )}
      </Card>
    );
  } else if (known) {
    const who = known.firstName ?? "the person who runs it";
    content = (
      <Card>
        <p className="text-[18px] font-extrabold leading-snug">
          {!known.hasLogin
            ? `${known.company} is already in Penney's list.`
            : known.sameFirstName
              ? `${known.company} is already set up under another phone number.`
              : `${known.company} is already set up.`}
        </p>
        <p className="mt-2 text-[16px] text-[var(--muted)]">
          {!known.hasLogin
            ? "Call the office and they'll set up your login."
            : known.sameFirstName
              ? "Sign in with that number, or call the office."
              : `Ask ${who} to post today, or call the office for your own login.`}
        </p>
        <p className="mt-2 text-[14px] text-[var(--muted)]">The Penney office has your name and number.</p>
        <div className="mt-5 space-y-3">
          {callButton}
          {known.hasLogin && known.sameFirstName && (
            <button
              type="button"
              onClick={() => {
                setKnown(null);
                switchMode("signin");
              }}
              className="btn btn-ghost btn-lg btn-block"
            >
              I have a PIN
            </button>
          )}
          <button type="button" onClick={() => setKnown(null)} className="btn btn-ghost btn-lg btn-block">
            ‹ Back
          </button>
        </div>
      </Card>
    );
  } else {
    content = (
      <>
        <p className="text-[16px] text-[var(--muted)]">Add photos and see the drawings for this job.</p>

        <div className="card grid grid-cols-2 gap-1 p-1" role="group" aria-label="Sign up or sign in">
          {(
            [
              ["signup", "First time"],
              ["signin", "I have a PIN"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`min-h-[48px] rounded-xl text-[16px] font-bold ${
                mode === m ? "bg-[var(--ink)] text-white" : "text-[var(--ink)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "signup" ? (
          <form onSubmit={signUp} className="card space-y-5 p-5">
            <div>
              <label htmlFor="site-name" className="label">
                Your name
              </label>
              <input
                id="site-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="First and last"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="site-company" className="label">
                Company
              </label>
              <input
                id="site-company"
                autoComplete="organization"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                onFocus={() => setCompanyFocused(true)}
                // Let a tap on a suggestion land before the list goes away.
                onBlur={() => window.setTimeout(() => setCompanyFocused(false), 150)}
                placeholder="Leave blank if it's just you"
                className={inputCls}
              />
              {visibleSuggestions.length > 0 && (
                <ul className="mt-2 divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-white">
                  {visibleSuggestions.map((s) => (
                    <li key={s.name}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setCompany(s.name);
                          setCompanyFocused(false);
                        }}
                        className="flex min-h-[60px] w-full items-center gap-3 px-4 text-left"
                      >
                        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{s.name}</span>
                        {s.onJob && (
                          <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--paper)] px-2.5 py-1 text-[13px] font-bold text-[var(--muted)]">
                            On this job
                          </span>
                        )}
                        <span aria-hidden className="shrink-0 text-[20px] text-[var(--muted)]">
                          ›
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <label htmlFor="site-trade" className="label">
                Trade
              </label>
              <select id="site-trade" value={trade} onChange={(e) => setTrade(e.target.value)} className={inputCls}>
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
                  aria-label="Your trade"
                  className={`${inputCls} mt-2`}
                />
              )}
            </div>
            {phoneField}
            <div>
              <label htmlFor="site-email" className="label">
                Email (optional)
              </label>
              <input
                id="site-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
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

            <PortalNotice notice={notice} onDismiss={() => setNotice(null)} />

            <button
              type="submit"
              disabled={busy || name.trim().length < 2 || !phone || pin.length !== 4}
              className="btn btn-primary btn-lg btn-block"
            >
              {busy ? "Signing you up…" : "Sign up & open the job"}
            </button>
          </form>
        ) : (
          <form onSubmit={signIn} className="card space-y-5 p-5">
            {phoneField}
            {pinField}
            <PortalNotice notice={notice} onDismiss={() => setNotice(null)} />
            <button
              type="submit"
              disabled={busy || !phone || pin.length < 4}
              className="btn btn-primary btn-lg btn-block"
            >
              {busy ? "Signing in…" : "Sign in & open the job"}
            </button>
            <button type="button" onClick={() => switchMode("signup")} className="btn btn-ghost btn-lg btn-block">
              First time here? Sign up
            </button>
          </form>
        )}
      </>
    );
  }

  return (
    <PortalTheme variant="field">
      {/* Static header: the job's name shows once, in the block below, where a long name wraps instead of truncating. */}
      <PortalHeader
        subtitle="Penney Construction"
        title="Job check-in"
        safeTop
        right={<HeaderAction href={telHref(OFFICE_PHONE)} label="Call" ariaLabel="Call the Penney office" />}
      />
      <main className="mx-auto w-full max-w-md space-y-4 px-4 py-5 pc-safe-bottom">
        {info && (
          <div>
            <h1 className="text-[26px] font-extrabold leading-tight">{info.project.name}</h1>
            <p className="mt-1 text-[15px] text-[var(--muted)]">
              {info.project.number}
              {info.project.town ? ` · ${info.project.town}` : ""}
            </p>
          </div>
        )}

        {content}

        {info?.loomUrl && (
          <a
            href={info.loomUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center justify-center text-[16px] font-bold text-[var(--accent-dark)] underline underline-offset-2"
          >
            Watch how · 1 min
          </a>
        )}
        <p className="pt-2 text-center text-[15px] text-[var(--muted)]">
          Questions? Call the office at{" "}
          <a href={telHref(OFFICE_PHONE)} className="font-bold text-[var(--ink)] underline underline-offset-2">
            {OFFICE_PHONE}
          </a>
        </p>
      </main>
    </PortalTheme>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="card p-5">{children}</div>;
}

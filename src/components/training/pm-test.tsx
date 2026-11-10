"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileText, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { finishPmTestScoring, resetPmTestAttempt, submitPmTest } from "@/lib/actions/pm-test";
import {
  PM_TEST_ANSWER_MAX_CHARS,
  PM_TEST_KEY,
  PM_TEST_SITUATIONS,
  scoreLabel,
  type PmTestAnswers,
  type PmTestAttempt,
  type PmTestChangeOrder,
  type PmTestState,
} from "@/lib/training/pm-test";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const DRAFT_KEY = `pm-test-draft:${PM_TEST_KEY}`;

function readDraft(): PmTestAnswers {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object") {
      const out: PmTestAnswers = {};
      for (const s of PM_TEST_SITUATIONS) {
        const v = (parsed as Record<string, unknown>)[String(s.n)];
        if (typeof v === "string") out[String(s.n)] = v;
      }
      return out;
    }
  } catch {
    // A blocked or corrupt draft just means starting blank.
  }
  return {};
}

function writeDraft(answers: PmTestAnswers | null) {
  try {
    if (answers) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(answers));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage is a convenience; the test works without it.
  }
}

const subscribeNoop = () => () => {};

export function PmTest({ state }: { state: PmTestState }) {
  // The answer boxes restore a draft from this browser, so they render only
  // once the page is live in the browser (never during server render).
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const { attempt } = state;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {state.isImpersonating && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          You are viewing this page as {state.viewerName}. Nothing can be submitted while viewing as someone else.
        </p>
      )}

      {attempt?.status === "graded" && <ResultView attempt={attempt} />}
      {attempt?.status === "needs_grading" && <PendingScore attempt={attempt} />}
      {!attempt && (
        <>
          <Intro state={state} />
          <HowToChangeOrder />
          <JobChangeOrders state={state} />
          {hydrated ? (
            <AnswerForm disabled={state.isImpersonating} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading the test…</p>
          )}
        </>
      )}

      {state.isReviewer && <ReviewerPanel attempts={state.allAttempts} ownAttemptId={attempt?.id ?? null} />}
    </div>
  );
}

// ── Before submitting ────────────────────────────────────────────────────────

function Intro({ state }: { state: PmTestState }) {
  const { job } = state;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Hall Bath training test</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm leading-relaxed">
        <p>
          Eight things happen on your TEST job. This is how clients usually act, so handle each one the way you would
          on a real job.
        </p>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>Read the signed contract.</li>
          <li>
            Do the work in the app. If a situation needs a change order, write it on the TEST job&apos;s Money tab and
            send it. The client email on this job is yours, so it lands in your inbox and you sign it as the client.
          </li>
          <li>Come back here and write what you did and what you told the client or the crew.</li>
          <li>Submit once. You get your score right away.</li>
        </ol>
        <p className="rounded-md border bg-muted/40 px-3 py-2">
          <span className="font-semibold">Pricing:</span> our own labor and materials are cost plus 40%. A sub&apos;s
          quote is plus 30%. TEST job only, and nothing goes to QuickBooks.
        </p>
        {job ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/generate-contract?projectId=${job.id}`} target="_blank" rel="noreferrer">
                <FileText className="size-4" /> Open the contract
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${job.id}?tab=finances`} target="_blank">
                <ExternalLink className="size-4" /> Open the TEST job{job.projectNumber ? ` (${job.projectNumber})` : ""}
              </Link>
            </Button>
          </div>
        ) : (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            No TEST job is assigned to you yet, so the change order part cannot be checked. Ask Jorge to set one up
            before you submit.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** The app's own steps, button names exactly as they read on the Money tab. */
function HowToChangeOrder() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How to do a change order</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>
            Open the TEST job and go to the <span className="font-semibold">Money</span> tab. Find{" "}
            <span className="font-semibold">Change Orders</span>.
          </li>
          <li>
            Tap <span className="font-semibold">New Change Order</span>. Fill in the Title (the short name the client
            sees), the Description (the scope in plain words), Our Cost and Client Price. For a credit, put a minus
            sign on both numbers. Tap <span className="font-semibold">Create Change Order</span>.
          </li>
          <li>
            Tap <span className="font-semibold">PDF</span> and read it the way the client will. Use{" "}
            <span className="font-semibold">Edit</span> if anything is off.
          </li>
          <li>
            Tap <span className="font-semibold">Send to Client</span>. The client gets an email with the change order
            PDF attached and a link to sign. Ryan, Nicole and Jorge are copied.
          </li>
          <li>
            On this TEST job the client email is yours. Open that email, tap the link and sign. The change order now
            shows Signed.
          </li>
        </ol>
        <p className="rounded-md border bg-muted/40 px-3 py-2">
          Do not tap <span className="font-semibold">Approve</span> yourself. The client approves by signing, and extra
          work does not start until it says Signed.
        </p>
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="font-semibold">Or ask Claude to do it</p>
          <p>With the Penney connector on in your Claude, the same change order takes three messages.</p>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            <li>
              <span className="font-semibold">Ask.</span> &ldquo;Write a change order on my Hall Bath TEST job for
              [what changed]. Cost $[cost], price $[price].&rdquo;
            </li>
            <li>
              <span className="font-semibold">Look.</span> Claude shows you the draft, then the exact email the client
              will get. Nothing is sent yet.
            </li>
            <li>
              <span className="font-semibold">Send.</span> Say &ldquo;send it&rdquo;. It goes from your email with the
              PDF attached, and you sign it from your inbox the same way.
            </li>
          </ol>
          <p className="text-muted-foreground">
            If Claude says it has no change order tool, disconnect the Penney connector and connect it again.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function JobChangeOrders({ state }: { state: PmTestState }) {
  if (!state.job) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Change orders on your TEST job right now</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {state.changeOrders.length === 0 ? (
          <p className="text-muted-foreground">None yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {state.changeOrders.map((co) => (
              <ChangeOrderLine key={co.number} co={co} />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          These are checked when you submit. Reload this page to refresh the list.
        </p>
      </CardContent>
    </Card>
  );
}

function ChangeOrderLine({ co }: { co: PmTestChangeOrder }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <span className="min-w-0 break-words">
        <span className="font-medium">CO #{co.number}</span> {co.title}
      </span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums">{money.format(co.price)}</span>
        <Badge variant={co.signed ? "default" : "outline"}>{co.signed ? "Signed" : co.sent ? "Sent" : "Not sent"}</Badge>
      </span>
    </li>
  );
}

function AnswerForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<PmTestAnswers>(readDraft);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Keep a draft in this browser so a closed tab does not lose the writing.
  useEffect(() => {
    writeDraft(answers);
  }, [answers]);

  const answered = PM_TEST_SITUATIONS.filter((s) => (answers[String(s.n)] ?? "").trim().length > 0).length;
  const blank = PM_TEST_SITUATIONS.length - answered;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitPmTest(answers);
      if ("error" in result) setError(result.error);
      else writeDraft(null);
      // Either way the page now has something new to show: the score, or the
      // saved attempt waiting on its score.
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {PM_TEST_SITUATIONS.map((s) => (
        <Card key={s.n}>
          <CardHeader>
            <CardTitle className="text-base">
              {s.n}. {s.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed">{s.prompt}</p>
            <Textarea
              value={answers[String(s.n)] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [String(s.n)]: e.target.value }))}
              placeholder="What did you do, and what did you tell the client or the crew?"
              maxLength={PM_TEST_ANSWER_MAX_CHARS}
              rows={4}
              disabled={pending || disabled}
              aria-label={`Your answer for situation ${s.n}`}
            />
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 text-sm">
          {pending ? (
            <p className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin" /> Scoring your answers. This takes about a minute. Keep this
              page open.
            </p>
          ) : confirming ? (
            <>
              <p className="font-medium">
                Submit now? You can only do this once.
                {blank > 0 ? ` ${blank} of 8 answers are still blank.` : ""}
              </p>
              <p className="text-muted-foreground">
                Your change orders on the TEST job are checked as they stand this minute.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={submit} disabled={disabled}>
                  Yes, submit
                </Button>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  Not yet
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setConfirming(true)} disabled={disabled || answered === 0}>
                Submit for my score
              </Button>
              <span className="text-muted-foreground">
                {answered} of 8 answered. Your writing is saved on this device as you go.
              </span>
            </div>
          )}
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ── After submitting ─────────────────────────────────────────────────────────

function PendingScore({ attempt }: { attempt: PmTestAttempt }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish() {
    setError(null);
    startTransition(async () => {
      const result = await finishPmTestScoring(attempt.id);
      if ("error" in result) setError(result.error);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Your answers are saved</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>The score was not worked out yet. Nothing you wrote was lost.</p>
        <div>
          <Button onClick={finish} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Scoring. About a minute.
              </>
            ) : (
              "Get my score"
            )}
          </Button>
        </div>
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function Mark({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1", ok ? "text-emerald-500" : "text-destructive")}>
      {ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
      <span className="text-foreground">{children}</span>
    </span>
  );
}

function ResultView({ attempt }: { attempt: PmTestAttempt }) {
  const score = attempt.score ?? 0;
  const breakdown = attempt.breakdown;
  const handsOn = breakdown?.handsOn;
  const written = breakdown?.written;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1 pt-6">
          <p className="text-sm text-muted-foreground">
            {attempt.takerName} · submitted{" "}
            {new Date(attempt.submittedAt).toLocaleString("en-US", {
              timeZone: "America/New_York",
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
          <p className="text-5xl font-bold tabular-nums">
            {score}
            <span className="text-2xl font-semibold text-muted-foreground"> / {attempt.maxScore}</span>
          </p>
          <p className="text-base font-medium">{scoreLabel(score)}</p>
        </CardContent>
      </Card>

      {handsOn && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Change orders on the TEST job: {handsOn.earned} / {handsOn.max}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!handsOn.hasJob && <p>No TEST job was assigned, so this part could not be checked.</p>}
            <ul className="flex flex-col divide-y">
              {handsOn.rows.map((row) => (
                <li key={row.key} className="flex flex-col gap-1.5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{row.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.earned} / {row.max}
                    </span>
                  </div>
                  {row.found ? (
                    <>
                      <p className="break-words text-muted-foreground">
                        CO #{row.coNumber} {row.title}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <Mark ok={row.priceRight}>
                          Price {money.format(row.price ?? 0)}
                          {!row.priceRight && ` (should be ${money.format(row.expectedPrice)})`}
                        </Mark>
                        <Mark ok={row.costRight}>
                          Cost {money.format(row.cost ?? 0)}
                          {!row.costRight && ` (should be ${money.format(row.expectedCost)})`}
                        </Mark>
                        <Mark ok={row.sent}>Sent</Mark>
                        <Mark ok={row.signed}>Signed</Mark>
                      </div>
                    </>
                  ) : (
                    <Mark ok={false}>
                      Not written. It should be {money.format(row.expectedPrice)} (cost {money.format(row.expectedCost)}
                      ).
                    </Mark>
                  )}
                </li>
              ))}
            </ul>
            {handsOn.traps.map((trap) => (
              <p key={trap.coNumber} className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                CO #{trap.coNumber} {trap.title} ({money.format(trap.price)}) should not exist. {trap.reason} That cost{" "}
                {trap.penalty} points.
              </p>
            ))}
            {handsOn.others.length > 0 && (
              <p className="text-muted-foreground">
                Not part of the test: {handsOn.others.map((o) => `CO #${o.coNumber} ${o.title}`).join(", ")}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {written && (
        <>
          <h2 className="pt-1 text-base font-semibold">
            Your answers: {written.earned} / {written.max}
          </h2>
          {written.situations.map((s) => (
            <Card key={s.n}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                  <span>
                    {s.n}. {s.title}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {s.earned} / {s.max}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
                <p className="text-muted-foreground">
                  {PM_TEST_SITUATIONS.find((p) => p.n === s.n)?.prompt}
                </p>
                <div className="rounded-md border bg-muted/40 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">You wrote</p>
                  <p className="whitespace-pre-wrap break-words">{s.answer || "(left blank)"}</p>
                </div>
                <ul className="flex flex-col gap-2">
                  {s.criteria.map((c) => (
                    <li key={c.id} className="flex flex-col gap-0.5">
                      <Mark ok={c.met}>
                        {c.label} ({c.met ? c.points : 0} / {c.points})
                      </Mark>
                      {c.note && <span className="pl-5 text-muted-foreground">{c.note}</span>}
                    </li>
                  ))}
                </ul>
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide">The right call</p>
                  <p>{s.rightCall}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

// ── Jorge and Ryan ───────────────────────────────────────────────────────────

function ReviewerPanel({ attempts, ownAttemptId }: { attempts: PmTestAttempt[]; ownAttemptId: string | null }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) setError(result.error);
      setConfirmResetId(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Results (only Jorge and Ryan see this)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {attempts.length === 0 && <p className="text-muted-foreground">Nobody has submitted yet.</p>}
        {attempts.map((a) => (
          <div key={a.id} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{a.takerName}</p>
                <p className="text-muted-foreground">
                  {new Date(a.submittedAt).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums">
                {a.status === "graded" ? `${a.score ?? 0} / ${a.maxScore}` : "Not scored yet"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {a.status === "graded" && a.id !== ownAttemptId && (
                <Button variant="outline" size="sm" onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                  {openId === a.id ? "Hide answers" : "See answers"}
                </Button>
              )}
              {a.status === "needs_grading" && (
                <Button size="sm" disabled={pending} onClick={() => run(() => finishPmTestScoring(a.id))}>
                  {pending ? "Scoring…" : "Score it now"}
                </Button>
              )}
              {confirmResetId === a.id ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => resetPmTestAttempt(a.id))}
                  >
                    Yes, erase this result
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmResetId(null)}>
                    Keep it
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmResetId(a.id)}>
                  Reset for a retake
                </Button>
              )}
            </div>
            {openId === a.id && a.status === "graded" && <ResultView attempt={a} />}
          </div>
        ))}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

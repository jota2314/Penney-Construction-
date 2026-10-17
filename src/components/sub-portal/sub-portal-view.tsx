"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  HeaderAction,
  PortalHeader,
  PortalNotice,
  PortalTabBar,
  PortalTheme,
  PreviewBanner,
  useHashTab,
  type PortalNoticeValue,
} from "@/components/portal-kit";
import { telHref } from "@/lib/portal-kit/format";
import type { SubHomePayload, SubNeededItem } from "@/lib/sub-portal/payload";
import { JobScreen, type JobView } from "./job-screen";
import { setSubOutboxOwner, useSubOutbox } from "./post-outbox";
import { SendInvoiceSheet } from "./send-invoice-sheet";
import { SignSheet } from "./sign-sheet";
import { TodayTab } from "./today-tab";
import { DatesTab } from "./dates-tab";
import { MoneyTab } from "./money-tab";

/**
 * The sub portal v3, one screen for both doors in:
 *  - /sub/portal (portal-app.tsx, his cookie), and
 *  - /sub-preview/{subId} (office staff, read-only: data.mode === "preview").
 *
 * Tabs are Today · Dates · Money (Money only for the company login), with
 * the URL hash as the tab (#dates, #money). Tapping a job opens the job
 * screen (job-screen.tsx) in place of the tabs; ?job={id} in the URL is
 * that job, so the phone's back button closes it and a refresh keeps it.
 * The site QR lands on ?job={id}&compose=1, which opens the job with the
 * composer focused.
 *
 * In preview every saving button is off (usePortalAction's `enabled`), and
 * the job screen fetches through the preview-data route instead of the
 * cookie. Opening things still works, so staff see what he sees.
 */

const TAB_KEYS = ["today", "dates", "money"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** How a job opens: with the composer focused, or on a segment other than Log. */
export interface OpenJobOptions {
  compose?: boolean;
  view?: JobView;
}

interface OpenJob {
  id: string;
  compose: boolean;
  view: JobView;
}

// Marks the history entries this screen pushed, so closing a job it opened
// steps back instead of stacking another entry.
const JOB_STATE_KEY = "pcSubJob";
const JOB_ID_RE = /^[0-9a-f-]{36}$/i;

/** ?job= (and &compose=1) from the address bar, or null. */
function readJobQuery(): OpenJob | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("job");
    if (!id || !JOB_ID_RE.test(id)) return null;
    return { id, compose: params.get("compose") === "1", view: "log" };
  } catch {
    return null;
  }
}

/** This page's URL with ?job= set (or cleared) and &compose dropped; the hash and other params stay. */
function jobUrl(jobId: string | null): string {
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("job", jobId);
  else url.searchParams.delete("job");
  url.searchParams.delete("compose");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The job this screen pushed the current history entry for, if it did. */
function pushedJobId(): string | null {
  try {
    const state = history.state as Record<string, unknown> | null;
    const value = state && typeof state === "object" ? state[JOB_STATE_KEY] : null;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Point the address bar at a job (or none). The state handed over carries
 * only our marker: Next.js copies its own router state in and keeps its
 * idea of the URL in step, which it skips when given its own state object.
 */
function writeJobUrl(mode: "push" | "replace", jobId: string | null, marker: string | null) {
  try {
    const state = marker ? { [JOB_STATE_KEY]: marker } : {};
    if (mode === "push") history.pushState(state, "", jobUrl(jobId));
    else history.replaceState(state, "", jobUrl(jobId));
  } catch {
    /* some in-app browsers refuse it; "‹ Your jobs" still closes the job */
  }
}

/**
 * Needed rows for features that are switched on. The loader leaves these
 * out already; this keeps a half-shipped feature from showing a button that
 * goes nowhere.
 */
function neededForFlags(data: SubHomePayload): SubNeededItem[] {
  return data.needed.filter((n) => {
    if (n.kind === "sign_agreement") return data.flags.agreements_enabled;
    if (n.kind === "bill_returned") return data.flags.bills_enabled;
    return true;
  });
}

export function SubPortalView({
  data,
  onReload,
  initialJobId = null,
  initialCompose = false,
}: {
  data: SubHomePayload;
  onReload: () => void;
  initialJobId?: string | null;
  initialCompose?: boolean;
}) {
  const router = useRouter();
  const preview = data.mode === "preview";
  const { flags } = data;
  const showMoney = flags.show_money && data.money != null;
  const canSendInvoice = flags.bills_enabled && !preview;

  const [active, go] = useHashTab(TAB_KEYS, "today");
  // A #money link on a login without money lands on Today.
  const tab: TabKey = active === "money" && !showMoney ? "today" : active;

  const [openJob, setOpenJob] = useState<OpenJob | null>(() =>
    initialJobId && JOB_ID_RE.test(initialJobId)
      ? { id: initialJobId, compose: initialCompose, view: "log" }
      : readJobQuery(),
  );
  const [focusPhaseId, setFocusPhaseId] = useState<string | null>(null);
  const [signId, setSignId] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<{ projectId: string | null } | null>(null);
  const [notice, setNotice] = useState<PortalNoticeValue | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  // Sign out with posts still on the phone: the first tap says they stay
  // (and go next time this company signs in here); the second signs out.
  const unsent = useSubOutbox().pending;
  const [signOutWarned, setSignOutWarned] = useState(false);
  const signOutWarning =
    signOutWarned && unsent > 0
      ? `${unsent} waiting to send. ${unsent === 1 ? "It stays" : "They stay"} on this phone and ${unsent === 1 ? "sends" : "send"} next time ${data.sub.company_name} signs in here.`
      : null;

  const needed = useMemo(() => neededForFlags(data), [data]);

  // Every job he may bill, once, for the invoice sheet's job picker: his live
  // jobs first, then any job he's still owed on (a final bill often comes
  // after the job closes), then a sent-back bill's job. The bills route
  // accepts all of these; leaving one out made the sheet open on another job.
  const invoiceJobs = useMemo(() => {
    const byId = new Map<string, { project_id: string; name: string }>();
    const add = (projectId: string | null, name: string | null) => {
      if (projectId && !byId.has(projectId)) byId.set(projectId, { project_id: projectId, name: name || "Job" });
    };
    for (const j of [...data.jobs.today, ...data.jobs.this_week, ...data.jobs.other]) add(j.project_id, j.name);
    for (const j of data.money?.by_job ?? []) add(j.project_id, j.project_name);
    for (const n of needed) if (n.kind === "bill_returned") add(n.project_id, n.project_name);
    return [...byId.values()];
  }, [data.jobs, data.money, needed]);

  // The job he last worked on, so the invoice sheet starts on it.
  const lastActiveJobId = useMemo(() => {
    const rows = [...data.jobs.today, ...data.jobs.this_week, ...data.jobs.other];
    const latest = rows
      .filter((j) => j.last_activity_at)
      .sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""))[0];
    return latest?.project_id ?? null;
  }, [data.jobs]);

  // Once, on arrival: put the open job in the address bar (when it came in
  // as a prop) and drop &compose=1, so a refresh shows the job without
  // jumping into the composer again.
  const firstJobId = useRef(openJob?.id ?? null);
  useEffect(() => {
    writeJobUrl("replace", firstJobId.current, pushedJobId());
  }, []);

  // The phone's back button: follow ?job= in the address bar.
  useEffect(() => {
    const onPop = () => {
      const q = readJobQuery();
      setOpenJob((prev) => (q ? (prev?.id === q.id ? prev : { ...q, compose: false }) : null));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Closing a job puts the list back where he was. The job screen does its
  // own scrolling on open (to the top, or to the composer from a QR).
  const listScroll = useRef(0);
  const openId = openJob?.id ?? null;
  useEffect(() => {
    if (!openId) window.scrollTo(0, listScroll.current);
  }, [openId]);

  const openJobScreen = useCallback((projectId: string, opts: OpenJobOptions = {}) => {
    listScroll.current = window.scrollY;
    writeJobUrl("push", projectId, projectId);
    setOpenJob({ id: projectId, compose: !!opts.compose, view: opts.view ?? "log" });
  }, []);

  // "‹ Your jobs": step back over the entry we pushed, so the phone's back
  // button doesn't reopen the job; a job he landed on (QR, refresh) just
  // drops ?job= instead.
  const closeJob = useCallback(() => {
    if (pushedJobId()) history.back();
    else writeJobUrl("replace", null, null);
    setOpenJob(null);
  }, []);

  // A Needed "Answer" row: Dates, scrolled to that phase.
  const answerDates = useCallback(
    (phaseId: string) => {
      setFocusPhaseId(phaseId);
      go("dates");
    },
    [go],
  );

  async function signOut() {
    if (preview) return;
    if (unsent > 0 && !signOutWarned) {
      setSignOutWarned(true);
      return;
    }
    setSigningOut(true);
    // Before the cookie goes: nothing saved under this company may be sent
    // under whoever signs in next. His entries stay on the phone for him.
    setSubOutboxOwner(null);
    try {
      await fetch("/api/sub-portal/login", { method: "DELETE", credentials: "same-origin" });
    } catch {
      /* the cookie may still be set; the login page is the right place either way */
    }
    router.replace("/sub");
  }

  return (
    <PortalTheme variant="field">
      {preview && (
        <PreviewBanner
          title={`Staff preview of ${data.preview?.sub_name ?? data.sub.company_name}'s portal`}
          detail={data.preview?.detail ?? "Nothing you tap here is saved."}
        />
      )}
      <PortalHeader
        subtitle="Penney Construction · Sub portal"
        title={data.sub.company_name}
        right={<HeaderAction href={telHref(flags.office_phone)} label="Call" ariaLabel="Call the office" />}
      />
      {openJob ? (
        // JobScreen is its own page column (<main>, gutters, safe-area bottom).
        <JobScreen
          key={openJob.id}
          projectId={openJob.id}
          previewSubId={preview ? data.sub.sub_id : null}
          compose={openJob.compose}
          initialView={openJob.view}
          onBack={closeJob}
          onChanged={onReload}
          jobsForInvoice={flags.bills_enabled ? invoiceJobs : undefined}
          billsEnabled={flags.bills_enabled}
          agreementsEnabled={flags.agreements_enabled}
          officePhone={flags.office_phone}
        />
      ) : (
        <>
          {/* The job screen has its own sending line under the composer. */}
          {!preview && <OutboxBanner />}
          <PortalTabBar
            active={tab}
            onChange={go}
            tabs={[
              { key: "today", label: "Today", badge: needed.length },
              { key: "dates", label: "Dates", badge: data.dates.answers_needed },
              { key: "money", label: "Money", hidden: !showMoney },
            ]}
          />
          <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
            <PortalNotice notice={notice} onDismiss={() => setNotice(null)} />
            {tab === "today" && (
              <TodayTab
                data={data}
                needed={needed}
                preview={preview}
                canFixBill={canSendInvoice}
                onOpenJob={openJobScreen}
                onAnswerDates={answerDates}
                onSign={setSignId}
                onFixBill={(projectId) => setInvoiceFor({ projectId })}
              />
            )}
            {tab === "dates" && (
              <DatesTab
                dates={data.dates}
                today={data.today}
                preview={preview}
                officePhone={flags.office_phone}
                onReload={onReload}
                focusPhaseId={focusPhaseId}
                onFocused={() => setFocusPhaseId(null)}
              />
            )}
            {tab === "money" && data.money && (
              <MoneyTab
                money={data.money}
                canSendInvoice={canSendInvoice}
                onSendInvoice={() => setInvoiceFor({ projectId: lastActiveJobId })}
                onOpenJob={openJobScreen}
              />
            )}
          </main>
          <PortalFooter
            loomUrl={flags.loom_url}
            officePhone={flags.office_phone}
            preview={preview}
            signingOut={signingOut}
            signOutWarning={signOutWarning}
            onSignOut={signOut}
          />
        </>
      )}

      {signId && flags.agreements_enabled && (
        <SignSheet
          agreementId={signId}
          preview={preview}
          onClose={() => setSignId(null)}
          onChanged={onReload}
          onSigned={() => {
            setSignId(null);
            setNotice({ tone: "success", text: "Signed. Penney has your signed copy." });
            onReload();
          }}
        />
      )}
      {invoiceFor && canSendInvoice && (
        <SendInvoiceSheet
          jobs={invoiceJobs}
          defaultProjectId={invoiceFor.projectId}
          onClose={() => setInvoiceFor(null)}
          onSent={() => {
            setInvoiceFor(null);
            setNotice({ tone: "success", text: "Sent. Penney has your invoice." });
            onReload();
          }}
        />
      )}
    </PortalTheme>
  );
}

/**
 * Posts and photos still on the phone (no signal, or the app was closed
 * mid-upload). They're kept in the outbox and finish on their own; this
 * says so, so he doesn't post the same photos twice.
 */
function OutboxBanner() {
  const { pending, sending, failed, refused, done, total, retryNow } = useSubOutbox();
  if (pending <= 0 && failed <= 0) return null;
  // What the server said, when it refused something: "1 didn't send: That job isn't on your list."
  const reason = refused.length > 0 ? `: ${asSentence(refused[0].error)}` : ".";
  let text: string;
  if (pending > 0 && sending > 0) {
    text = total > 0 ? `Sending ${Math.min(done, total)} of ${total} · it finishes next time you open the app.` : "Sending · it finishes next time you open the app.";
  } else if (pending > 0) {
    text = `${pending} waiting to send · ${pending === 1 ? "it goes" : "they go"} when you have signal.`;
  } else {
    text = `${failed} didn't send${reason}`;
  }
  if (pending > 0 && failed > 0) text += ` ${failed} didn't send${reason}`;
  // Nothing moving, or something stuck: let him push it along.
  const showRetry = sending === 0 || failed > 0;
  return (
    <div className="border-b border-[var(--line)] bg-[#F1F0EC]">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2">
        <p role="status" className="min-w-0 flex-1 text-[15px] font-semibold">
          <span aria-hidden className="mr-1.5">●</span>
          {text}
        </p>
        {showRetry && (
          <button type="button" onClick={retryNow} className="btn btn-ghost shrink-0">
            {failed > 0 ? "Try again" : "Try now"}
          </button>
        )}
      </div>
    </div>
  );
}

function asSentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Watch how (only when the Loom is set) · Call the office · Sign out. */
function PortalFooter({
  loomUrl,
  officePhone,
  preview,
  signingOut,
  signOutWarning,
  onSignOut,
}: {
  loomUrl: string | null;
  officePhone: string;
  preview: boolean;
  signingOut: boolean;
  /** Posts still on the phone; shown after the first Sign out tap. */
  signOutWarning: string | null;
  onSignOut: () => void;
}) {
  return (
    <footer className="pc-safe-bottom mx-auto max-w-2xl space-y-3 px-4 pt-4">
      {loomUrl && (
        <a href={loomUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-block">
          Watch how (1 min)
        </a>
      )}
      <a href={telHref(officePhone)} className="btn btn-ghost btn-block">
        Call the office · {officePhone}
      </a>
      {signOutWarning && (
        <p role="status" className="text-center text-[15px] font-semibold">
          {signOutWarning}
        </p>
      )}
      <button type="button" onClick={onSignOut} disabled={preview || signingOut} className="btn btn-ghost btn-block">
        {signingOut ? "Signing out…" : signOutWarning ? "Sign out anyway" : "Sign out"}
      </button>
      <p className="pb-6 pt-2 text-center text-[13px] text-[var(--muted)]">Penney Construction, Inc. · North Shore, MA</p>
    </footer>
  );
}

import type { ReactNode } from "react";
import { QrCode } from "@/components/site-qr/qr-code";
import { portalFont } from "@/components/portal/portal-font";

/**
 * The printed job-site sign (one letter page, taped in a sheet protector at
 * the entry door) and the half-page binder-cover label. Shared by
 * /job-qr/{id} and the bulk print page /job-qr/all. Server-safe: no hooks.
 *
 * Plan §3.1 copy. The sign is about the daily log, not the clock: scan when
 * you arrive, add photos, post. The PT and ES lines need a native speaker's
 * read before the first big print run.
 */

const INK = "#252D2B";
const MUTED = "#4F5953";
const LINE = "#E4E0D8";
const ACCENT_DARK = "#9E4E28";

export const SITE_SIGN_COPY = {
  headline: "SUBCONTRACTORS: scan when you arrive",
  steps: ["Scan", "Add photos", "Post"],
  pt: "Subempreiteiros: escaneie ao chegar e poste as fotos antes de sair.",
  es: "Subcontratistas: escaneen al llegar y suban sus fotos antes de irse.",
  firstTime: "First time? Sign up with your cell and a 4-digit PIN.",
  watch: "Watch how · 1 min",
} as const;

export type SiteSignJob = {
  name: string;
  project_number: string;
  /** The street line, already joined ("12 Elm St, Peabody, MA"). */
  address: string | null;
};

/**
 * Letter pages, margins, and one page per sheet. Print backgrounds are kept
 * exact so the step numbers and the QR frame print as designed.
 */
const PRINT_CSS = `
@page { size: letter; margin: 0.45in; }
@media print {
  .site-sign-page { break-after: page; page-break-after: always; break-inside: avoid; }
  .site-sign-run > .site-sign-page:last-child { break-after: auto; page-break-after: auto; }
  .site-sign-print-exact, .site-sign-print-exact * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export function SiteSignPrintStyles() {
  return <style>{PRINT_CSS}</style>;
}

/** The pages that print, in order. Screen: stacked cards; print: one per sheet. */
export function SignRun({ children }: { children: ReactNode }) {
  return <div className="site-sign-run site-sign-print-exact space-y-6 print:space-y-0">{children}</div>;
}

/** One printed sheet. */
export function SignPage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`site-sign-page ${className}`}>{children}</div>;
}

function jobLine(job: SiteSignJob): string {
  return `${job.project_number}${job.address ? ` · ${job.address}` : ""}`;
}

/** "1 Scan · 2 Add photos · 3 Post" with the numbers in rings. */
function Steps({ size, align = "center" }: { size: "lg" | "sm"; align?: "center" | "start" }) {
  const ring = size === "lg" ? 40 : 28;
  return (
    <ol
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${align === "center" ? "justify-center" : "justify-start"}`}
    >
      {SITE_SIGN_COPY.steps.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold"
            style={{
              width: ring,
              height: ring,
              border: `3px solid ${ACCENT_DARK}`,
              color: ACCENT_DARK,
              fontSize: size === "lg" ? 20 : 15,
            }}
          >
            {i + 1}
          </span>
          <span className="whitespace-nowrap font-extrabold" style={{ fontSize: size === "lg" ? 24 : 17 }}>
            {step}
          </span>
          {i < SITE_SIGN_COPY.steps.length - 1 && (
            <span aria-hidden className="pl-2 font-extrabold" style={{ color: MUTED, fontSize: size === "lg" ? 24 : 17 }}>
              ·
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The entry-door sign: logo, the one instruction, the job, a big QR, the
 * three steps, Portuguese and Spanish, first-time line, office phone, and a
 * small "Watch how" QR when the Loom is set.
 */
export function SiteSign({
  job,
  url,
  loomUrl,
  officePhone,
}: {
  job: SiteSignJob;
  url: string;
  loomUrl?: string | null;
  officePhone: string;
}) {
  return (
    <section
      className={`${portalFont.className} mx-auto flex w-full max-w-[8.5in] flex-col items-center rounded-xl bg-white px-10 py-9 text-center shadow-sm print:max-w-none print:rounded-none print:px-0 print:py-0 print:shadow-none`}
      style={{ color: INK }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- print sheet: plain img prints reliably */}
      <img src="/logo.jpg" alt="Penney Construction, Inc." className="h-[0.8in] w-auto object-contain" />

      <h2 className="mt-4 text-[28px] font-extrabold leading-[1.1]" style={{ color: ACCENT_DARK }}>
        {SITE_SIGN_COPY.headline}
      </h2>
      <p className="mt-3 text-[24px] font-extrabold leading-tight">{job.name}</p>
      <p className="mt-0.5 text-[14px]" style={{ color: MUTED }}>
        {jobLine(job)}
      </p>

      <div className="mt-4 rounded-[18px] p-2.5" style={{ border: `3px solid ${INK}` }}>
        <QrCode value={url} title={`Check in at ${job.name}`} className="h-[3.7in] w-[3.7in]" />
      </div>

      <div className="mt-5">
        <Steps size="lg" />
      </div>

      <div className="mt-4 space-y-1 text-[15px] leading-snug" style={{ color: MUTED }}>
        <p lang="pt">{SITE_SIGN_COPY.pt}</p>
        <p lang="es">{SITE_SIGN_COPY.es}</p>
      </div>
      <p className="mt-3 text-[16px] font-bold">{SITE_SIGN_COPY.firstTime}</p>

      <footer className="mt-5 flex w-full items-end gap-4 pt-3 text-left" style={{ borderTop: `1px solid ${LINE}` }}>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold">Penney office {officePhone}</p>
          <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
            Penney crew: use the Penney app.
          </p>
          <p className="mt-1 break-all font-mono text-[12px] tracking-wide" style={{ color: MUTED }}>
            {url.replace("https://", "")}
          </p>
        </div>
        {loomUrl && (
          <div className="flex shrink-0 flex-col items-center">
            <QrCode value={loomUrl} title="Watch how to post" className="h-[0.95in] w-[0.95in]" />
            <p className="mt-1 whitespace-nowrap text-[12px] font-bold">{SITE_SIGN_COPY.watch}</p>
          </div>
        )}
      </footer>
    </section>
  );
}

/**
 * The binder-cover label: half a letter sheet, dashed edge as the cut line.
 * Same QR as the door sign, so a scan of either checks him in.
 */
export function BinderLabel({ job, url, officePhone }: { job: SiteSignJob; url: string; officePhone: string }) {
  return (
    <section
      className={`${portalFont.className} mx-auto flex w-full max-w-[8.5in] items-center gap-6 rounded-xl bg-white p-6 text-left print:max-w-none print:rounded-none`}
      style={{ color: INK, border: `2px dashed ${MUTED}`, minHeight: "4.2in" }}
    >
      <div className="shrink-0 rounded-[14px] p-2" style={{ border: `3px solid ${INK}` }}>
        <QrCode value={url} title={`Check in at ${job.name}`} className="h-[2.7in] w-[2.7in]" />
      </div>
      <div className="min-w-0 flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- print sheet: plain img prints reliably */}
        <img src="/logo.jpg" alt="Penney Construction, Inc." className="h-[0.5in] w-auto object-contain" />
        <p className="mt-2 text-[14px] font-bold" style={{ color: ACCENT_DARK }}>
          Job binder
        </p>
        <p className="text-[24px] font-extrabold leading-tight">{job.name}</p>
        <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
          {jobLine(job)}
        </p>
        <p className="mt-3 text-[17px] font-extrabold leading-snug" style={{ color: ACCENT_DARK }}>
          {SITE_SIGN_COPY.headline}
        </p>
        <div className="mt-2">
          <Steps size="sm" align="start" />
        </div>
        <p className="mt-3 text-[13px] font-semibold">{SITE_SIGN_COPY.firstTime}</p>
        <p className="mt-1 text-[13px] font-extrabold">Penney office {officePhone}</p>
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import { ArrowLeft, Download, FileText, Phone } from "lucide-react";
import { HeaderAction, PortalHeader, PortalTheme } from "@/components/portal-kit";
import { getGuestJobDocuments, type GuestJobDocument } from "@/lib/site-qr/guest-documents";
import { getGuestJobScope } from "@/lib/site-qr/guest-scope";
import { normalizeSiteCode } from "@/lib/sub-portal/site-code";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Job drawings, specs and scope | Penney Construction",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

function DocumentList({ title, files, code }: { title: string; files: GuestJobDocument[]; code: string }) {
  return <section className="card space-y-3 p-4">
    <h2 className="text-lg font-extrabold">{title}</h2>
    {files.length ? <ul className="divide-y divide-[var(--line)]">
      {files.map((file) => <li key={file.id}>
        <a href={`/api/site-documents/${encodeURIComponent(code)}/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer" className="flex min-h-14 items-center gap-3 py-3 font-semibold">
          <FileText className="h-5 w-5 shrink-0 text-[var(--muted)]" />
          <span className="min-w-0 flex-1 break-words">{file.filename}</span>
          <span className="text-sm text-[var(--muted)]">Open</span>
        </a>
      </li>)}
    </ul> : <p className="text-sm text-[var(--muted)]">No {title.toLowerCase()} are available here yet. Ask the Penney office for the document you need.</p>}
  </section>;
}

export default async function GuestJobDocumentsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = normalizeSiteCode(rawCode);
  const [documents, scopeResult] = await Promise.allSettled([
    getGuestJobDocuments(code),
    getGuestJobScope(code),
  ]);
  const docs = documents.status === "fulfilled" ? documents.value : null;
  const scope = scopeResult.status === "fulfilled" ? scopeResult.value : null;
  const project = docs?.project ?? scope?.project;
  const unavailable = documents.status === "rejected" && documents.reason?.status === 404 && scopeResult.status === "fulfilled" && !scope;

  return <PortalTheme variant="field">
    <PortalHeader title="Job documents" safeTop right={<HeaderAction href="tel:9786214387" label="Call" ariaLabel="Call the Penney office" />} />
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-5 pc-safe-bottom">
      <a href={`/sub/j/${encodeURIComponent(code)}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"><ArrowLeft className="h-4 w-4" />Back to daily log</a>
      {!project ? <section className="card space-y-3 p-5">
        <h1 className="text-xl font-extrabold">{unavailable ? "This job isn't available" : "Couldn't load the job documents"}</h1>
        <p className="text-[var(--muted)]">{unavailable ? "Scan the job's QR code again or call the Penney office." : "Refresh this page to try again, or call the Penney office for help."}</p>
        {!unavailable && <a href={`/sub/j/${encodeURIComponent(code)}/documents`} className="btn btn-primary btn-lg btn-block">Try again</a>}
        <a href="tel:9786214387" className="btn btn-ghost btn-lg btn-block"><Phone className="h-5 w-5" />Call the office</a>
      </section> : <>
        <header>
          <h1 className="break-words text-[26px] font-extrabold leading-tight">{project.name}</h1>
          <p className="mt-1 text-[15px] text-[var(--muted)]">{[project.number, project.town].filter(Boolean).join(" · ")}</p>
          <p className="mt-3 text-sm text-[var(--muted)]">Job drawings, specifications and scope. No account or PIN needed.</p>
        </header>

        <section className="card space-y-3 p-4">
          <h2 className="text-lg font-extrabold">Scope of work</h2>
          {scope?.source && scope.sections.length ? <>
            <p className="text-sm text-[var(--muted)]">Download the job scope without prices, or choose your trade below.</p>
            <a href={`/api/site-scope/${encodeURIComponent(code)}`} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg btn-block"><Download className="h-5 w-5" />Open full scope PDF</a>
            {scope.sections.filter((section) => section.id !== "general").length > 0 && <div className="space-y-2 pt-1">
              <h3 className="text-sm font-bold">By trade</h3>
              <p className="text-xs text-[var(--muted)]">Trade PDFs also include any general job requirements.</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {scope.sections.filter((section) => section.id !== "general").map((section) => <li key={section.id}>
                  <a href={`/api/site-scope/${encodeURIComponent(code)}?trade=${encodeURIComponent(section.id)}`} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-semibold"><span className="break-words">{section.label}</span><Download className="h-4 w-4 shrink-0" /></a>
                </li>)}
              </ul>
            </div>}
          </> : <p className="text-sm text-[var(--muted)]">{scope?.unavailableReason ?? (scopeResult.status === "rejected" ? "Couldn't load the scope. Refresh this page to try again." : "An approved scope isn't available for this job yet. Ask the Penney office.")}</p>}
        </section>

        {docs ? <>
          <DocumentList title="Drawings" files={docs.drawings} code={code} />
          <DocumentList title="Specs" files={docs.specs} code={code} />
        </> : <section className="card space-y-3 p-4">
          <h2 className="text-lg font-extrabold">Drawings &amp; specs</h2>
          <p className="text-sm text-[var(--muted)]">Couldn&apos;t load the files. Refresh this page to try again.</p>
          <a href={`/sub/j/${encodeURIComponent(code)}/documents`} className="btn btn-ghost btn-lg btn-block">Try again</a>
        </section>}
      </>}
    </main>
  </PortalTheme>;
}

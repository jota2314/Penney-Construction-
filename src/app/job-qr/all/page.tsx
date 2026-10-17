import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalJob } from "@/lib/crew/crew-visibility";
import { SUB_LIVE_STATUSES, subLiveRank } from "@/lib/sub-portal/statuses";
import {
  SITE_OFFICE_PHONE,
  canManageSiteSigns,
  ensureSiteCodes,
  getSubPortalLoomUrl,
  siteUrl,
} from "@/lib/sub-portal/site-code";
import { PROJECT_STATUS_LABELS } from "@/lib/constants/project";
import type { ProjectStatus } from "@/types/database";
import { PrintSignsButton, SignPostedTick } from "@/components/site-qr/site-sign-controls";
import {
  BinderLabel,
  SignPage,
  SignRun,
  SiteSign,
  SiteSignPrintStyles,
  type SiteSignJob,
} from "@/components/site-qr/site-sign";

export const metadata: Metadata = { title: "Job signs | Penney Construction" };
export const dynamic = "force-dynamic";

type PrintMode = "both" | "signs" | "labels";
type ShowMode = "all" | "missing";

type JobRow = {
  id: string;
  name: string;
  project_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  status: string;
  is_overhead: boolean | null;
  site_code: string | null;
  site_sign_posted_at: string | null;
  site_sign_posted_by: string | null;
};

const PRINT_MODES: { key: PrintMode; label: string }[] = [
  { key: "both", label: "Signs + binder labels" },
  { key: "signs", label: "Door signs only" },
  { key: "labels", label: "Binder labels only" },
];

const statusName = (s: string) =>
  PROJECT_STATUS_LABELS[s as ProjectStatus] ?? (s === "on_hold" ? "On hold" : s);

/**
 * /job-qr/all — every live job's QR sign in one print run, so the PMs can
 * post them all at once (plan §3.1). Live = Contracted, In Progress, On Hold,
 * never the office/shop/warehouse jobs. Opening it mints any missing site
 * codes. Each job prints a letter-size door sign and a half-page binder
 * label; the "Sign is up" ticks above the run (screen only) record which
 * jobs have one on site. Office roles only; a field login goes to /crew.
 */
export default async function AllJobSignsPage({
  searchParams,
}: {
  searchParams: Promise<{ print?: string; show?: string }>;
}) {
  const user = await requireAuth();
  if (!canManageSiteSigns(user.profile?.role)) redirect("/crew");
  const sp = await searchParams;
  const print: PrintMode = sp.print === "signs" || sp.print === "labels" ? sp.print : "both";
  const show: ShowMode = sp.show === "missing" ? "missing" : "all";

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select(
      "id, name, project_number, address, city, state, status, is_overhead, site_code, site_sign_posted_at, site_sign_posted_by",
    )
    .in("status", [...SUB_LIVE_STATUSES]);
  if (error) throw new Error(error.message);

  const jobs = ((data as JobRow[] | null) ?? [])
    .filter((p) => !isInternalJob(p))
    .sort((a, b) => subLiveRank(a.status) - subLiveRank(b.status) || a.name.localeCompare(b.name));

  const posterIds = Array.from(new Set(jobs.map((j) => j.site_sign_posted_by).filter((id): id is string => !!id)));
  const [codes, loomUrl, postersRes] = await Promise.all([
    ensureSiteCodes(admin, jobs),
    getSubPortalLoomUrl(admin),
    posterIds.length
      ? admin.from("profiles").select("id, full_name").in("id", posterIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ]);
  const posterName = new Map(
    ((postersRes.data as { id: string; full_name: string | null }[] | null) ?? []).map((p) => [p.id, p.full_name]),
  );

  const postedCount = jobs.filter((j) => j.site_sign_posted_at).length;
  const shown = (show === "missing" ? jobs.filter((j) => !j.site_sign_posted_at) : jobs).filter((j) => codes.has(j.id));
  const failed = jobs.filter((j) => !codes.has(j.id));

  const signJob = (j: JobRow): SiteSignJob => ({
    name: j.name,
    project_number: j.project_number,
    address: [j.address, j.city, j.state].filter(Boolean).join(", ") || null,
  });
  const href = (next: { print?: PrintMode; show?: ShowMode }) => {
    const params = new URLSearchParams();
    const p = next.print ?? print;
    const s = next.show ?? show;
    if (p !== "both") params.set("print", p);
    if (s !== "all") params.set("show", s);
    const qs = params.toString();
    return qs ? `/job-qr/all?${qs}` : "/job-qr/all";
  };
  const pill = (active: boolean) =>
    `inline-flex min-h-[36px] items-center rounded-full border px-3 text-sm font-medium ${
      active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
    }`;

  // Labels-only prints two per sheet (cut on the dashed line).
  const labelPairs: JobRow[][] = [];
  for (let i = 0; i < shown.length; i += 2) labelPairs.push(shown.slice(i, i + 2));
  const printCount = print === "both" ? shown.length * 2 : print === "labels" ? labelPairs.length : shown.length;

  return (
    <div className="min-h-screen bg-stone-100 px-4 py-6 text-stone-900 print:bg-white print:p-0">
      <SiteSignPrintStyles />
      <div className="mx-auto max-w-[8.5in] space-y-4">
        <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm print:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/projects" className="text-sm font-medium text-stone-600 hover:text-stone-900">
              ‹ Projects
            </Link>
            <h1 className="text-lg font-bold">Job signs</h1>
            <span className="text-sm text-stone-600">
              {postedCount} of {jobs.length} live jobs have a sign up
            </span>
            <div className="ml-auto">
              <PrintSignsButton
                label={shown.length === 0 ? "Nothing to print" : `Print ${printCount} page${printCount === 1 ? "" : "s"}`}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={href({ show: "all" })} className={pill(show === "all")}>
              All live jobs ({jobs.length})
            </Link>
            <Link href={href({ show: "missing" })} className={pill(show === "missing")}>
              No sign up yet ({jobs.length - postedCount})
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRINT_MODES.map((m) => (
              <Link key={m.key} href={href({ print: m.key })} className={pill(print === m.key)}>
                {m.label}
              </Link>
            ))}
          </div>
          <p className="text-sm text-stone-600">
            Tape the door sign in a sheet protector at the entry and the label on the job binder. Tick &ldquo;Sign is
            up&rdquo; once it&apos;s on site.
          </p>
        </div>

        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl bg-white shadow-sm print:hidden">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/job-qr/${j.id}`} className="block truncate font-semibold hover:underline">
                  {j.name}
                </Link>
                <p className="truncate text-xs text-stone-500">
                  {j.project_number} · {statusName(j.status)}
                  {codes.has(j.id) ? "" : " · couldn't make a QR code, open the job's page to retry"}
                </p>
              </div>
              <SignPostedTick
                projectId={j.id}
                postedAt={j.site_sign_posted_at}
                postedBy={j.site_sign_posted_by ? (posterName.get(j.site_sign_posted_by) ?? null) : null}
              />
            </li>
          ))}
          {jobs.length === 0 && <li className="px-4 py-6 text-center text-sm text-stone-500">No live jobs right now.</li>}
        </ul>

        {failed.length > 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
            {failed.length} job{failed.length === 1 ? "" : "s"} couldn&apos;t get a QR code and {failed.length === 1 ? "is" : "are"}{" "}
            left out of the print run. Reload to try again.
          </p>
        )}

        {shown.length === 0 ? (
          <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-stone-500 shadow-sm print:hidden">
            {show === "missing" ? "Every live job has a sign up." : "No signs to print."}
          </p>
        ) : (
          <SignRun>
            {print === "labels"
              ? labelPairs.map((pair) => (
                  <SignPage key={pair.map((j) => j.id).join("-")} className="space-y-[0.3in]">
                    {pair.map((j) => (
                      <BinderLabel
                        key={j.id}
                        job={signJob(j)}
                        url={siteUrl(codes.get(j.id) as string)}
                        officePhone={SITE_OFFICE_PHONE}
                      />
                    ))}
                  </SignPage>
                ))
              : shown.flatMap((j) => {
                  const job = signJob(j);
                  const url = siteUrl(codes.get(j.id) as string);
                  const pages = [
                    <SignPage key={`${j.id}-sign`}>
                      <SiteSign job={job} url={url} loomUrl={loomUrl} officePhone={SITE_OFFICE_PHONE} />
                    </SignPage>,
                  ];
                  if (print === "both") {
                    pages.push(
                      <SignPage key={`${j.id}-label`}>
                        <BinderLabel job={job} url={url} officePhone={SITE_OFFICE_PHONE} />
                      </SignPage>,
                    );
                  }
                  return pages;
                })}
          </SignRun>
        )}
      </div>
    </div>
  );
}

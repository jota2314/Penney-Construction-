export type JobView = "info" | "drawings" | "log" | "paperwork";

export const JOB_ID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A site-photo link opens the composer once. Ordinary job links open the brief. */
export function parseJobLink(params: URLSearchParams) {
  const id = params.get("job");
  if (!id || !JOB_ID_RE.test(id)) return null;
  const compose = params.get("compose") === "1";
  const section = params.get("view");
  const view: JobView = section === "drawings" || section === "log" || section === "paperwork" ? section : "info";
  return { id, compose, view: compose ? "log" as const : view };
}

export function jobLink(href: string, jobId: string | null, view: JobView) {
  const url = new URL(href);
  if (jobId) url.searchParams.set("job", jobId);
  else url.searchParams.delete("job");
  url.searchParams.delete("compose");
  if (jobId && view !== "info") url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  return `${url.pathname}${url.search}${url.hash}`;
}

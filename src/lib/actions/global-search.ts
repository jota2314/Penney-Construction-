"use server";

import { createClient } from "@/lib/supabase/server";

export type SearchGroup =
  | "projects"
  | "customers"
  | "subcontractors"
  | "emails"
  | "quotes"
  | "estimates"
  | "files";

export interface SearchResult {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle?: string;
  meta?: string;
  href: string;
}

export interface GlobalSearchResponse {
  query: string;
  results: SearchResult[];
  totalsByGroup: Partial<Record<SearchGroup, number>>;
}

const PER_GROUP_LIMIT = 5;

export async function globalSearch(rawQuery: string): Promise<GlobalSearchResponse> {
  const query = rawQuery.trim();
  if (query.length < 2) {
    return { query, results: [], totalsByGroup: {} };
  }

  const supabase = await createClient();
  const like = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safe = <T>(p: PromiseLike<{ data: T | null; error: unknown }>) =>
    Promise.resolve(p).catch(() => ({ data: null as T | null, error: true }));

  const [
    projectsRes,
    customersRes,
    subsRes,
    emailsRes,
    quotesRes,
    estimatesRes,
    filesRes,
  ] = await Promise.all([
    safe(
      supabase
        .from("projects")
        .select("id, project_number, name, address, status")
        .or(`name.ilike.${like},project_number.ilike.${like},address.ilike.${like}`)
        .limit(PER_GROUP_LIMIT)
    ),
    safe(
      supabase
        .from("customers")
        .select("id, first_name, last_name, email, phone")
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
        .limit(PER_GROUP_LIMIT)
    ),
    safe(
      supabase
        .from("subcontractors")
        .select("id, company_name, contact_name, email, trades")
        .or(`company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like}`)
        .limit(PER_GROUP_LIMIT)
    ),
    safe(
      supabase
        .from("inbox_emails")
        .select("id, subject, from_name, from_email, snippet, date")
        .or(`subject.ilike.${like},from_name.ilike.${like},from_email.ilike.${like},snippet.ilike.${like}`)
        .order("date", { ascending: false })
        .limit(PER_GROUP_LIMIT)
    ),
    safe(
      supabase
        .from("quote_requests")
        .select("id, project_id, subcontractor_name, trade, amount, project_name")
        .or(`subcontractor_name.ilike.${like},trade.ilike.${like},project_name.ilike.${like}`)
        .limit(PER_GROUP_LIMIT)
    ),
    safe(
      supabase
        .from("estimates")
        .select("id, name, project_id, lead_id, total_price, status")
        .ilike("name", like)
        .limit(PER_GROUP_LIMIT)
    ),
    safe(
      supabase
        .from("inbox_emails")
        .select("id, subject, attachments, date")
        .not("attachments", "is", null)
        .filter("attachments::text", "ilike", like)
        .order("date", { ascending: false })
        .limit(PER_GROUP_LIMIT * 2)
    ),
  ]);

  const results: SearchResult[] = [];
  const totalsByGroup: Partial<Record<SearchGroup, number>> = {};

  type Project = { id: string; project_number: string; name: string; address: string | null; status: string };
  const projects = (!projectsRes.error && projectsRes.data as Project[] | null) || [];
  totalsByGroup.projects = projects.length;
  for (const p of projects) {
    results.push({
      id: p.id,
      group: "projects",
      title: p.name,
      subtitle: p.project_number,
      meta: p.address ?? undefined,
      href: `/projects/${p.id}`,
    });
  }

  type Customer = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null };
  const customers = (!customersRes.error && customersRes.data as Customer[] | null) || [];
  totalsByGroup.customers = customers.length;
  for (const c of customers) {
    const name = `${c.first_name} ${c.last_name}`.trim();
    results.push({
      id: c.id,
      group: "customers",
      title: name || c.email || "Customer",
      subtitle: c.email ?? undefined,
      meta: c.phone ?? undefined,
      href: `/customers?highlight=${c.id}`,
    });
  }

  type Sub = { id: string; company_name: string; contact_name: string | null; email: string | null; trades: string[] | null };
  const subs = (!subsRes.error && subsRes.data as Sub[] | null) || [];
  totalsByGroup.subcontractors = subs.length;
  for (const s of subs) {
    results.push({
      id: s.id,
      group: "subcontractors",
      title: s.company_name,
      subtitle: s.contact_name ?? s.email ?? undefined,
      meta: s.trades?.join(", "),
      href: `/subcontractors?highlight=${s.id}`,
    });
  }

  type Email = { id: string; subject: string; from_name: string | null; from_email: string; snippet: string | null; date: string };
  const emails = (!emailsRes.error && emailsRes.data as Email[] | null) || [];
  totalsByGroup.emails = emails.length;
  for (const e of emails) {
    results.push({
      id: e.id,
      group: "emails",
      title: e.subject || "(no subject)",
      subtitle: e.from_name || e.from_email,
      meta: e.snippet?.substring(0, 80),
      href: `/command-center/email/${e.id}`,
    });
  }

  type Quote = { id: string; project_id: string | null; subcontractor_name: string; trade: string | null; amount: number | null; project_name: string | null };
  const quotes = (!quotesRes.error && quotesRes.data as Quote[] | null) || [];
  totalsByGroup.quotes = quotes.length;
  for (const q of quotes) {
    const amountLabel = q.amount != null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(q.amount)
      : "—";
    results.push({
      id: q.id,
      group: "quotes",
      title: `${q.subcontractor_name}${q.trade ? ` · ${q.trade}` : ""}`,
      subtitle: q.project_name || undefined,
      meta: amountLabel,
      href: q.project_id ? `/projects/${q.project_id}/bids` : `/bids`,
    });
  }

  type Estimate = { id: string; name: string; project_id: string | null; lead_id: string | null; total_price: number; status: string };
  const estimates = (!estimatesRes.error && estimatesRes.data as Estimate[] | null) || [];
  totalsByGroup.estimates = estimates.length;
  for (const est of estimates) {
    const priceLabel = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(est.total_price || 0);
    const href = est.project_id
      ? `/projects/${est.project_id}/estimates/${est.id}`
      : `/estimates/${est.id}`;
    results.push({
      id: est.id,
      group: "estimates",
      title: est.name,
      subtitle: est.status,
      meta: priceLabel,
      href,
    });
  }

  type EmailFile = { id: string; subject: string; attachments: Array<{ filename?: string; storage_path?: string }> | null; date: string };
  const fileEmails = (!filesRes.error && filesRes.data as EmailFile[] | null) || [];
  const seenFiles = new Set<string>();
  const fileResults: SearchResult[] = [];
  const q = query.toLowerCase();
  for (const em of fileEmails) {
    if (!em.attachments) continue;
    for (const att of em.attachments) {
      const filename = att.filename || "";
      if (!filename.toLowerCase().includes(q)) continue;
      const key = `${em.id}::${filename}`;
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      fileResults.push({
        id: key,
        group: "files",
        title: filename,
        subtitle: em.subject,
        href: `/command-center/email/${em.id}`,
      });
      if (fileResults.length >= PER_GROUP_LIMIT) break;
    }
    if (fileResults.length >= PER_GROUP_LIMIT) break;
  }
  totalsByGroup.files = fileResults.length;
  results.push(...fileResults);

  return { query, results, totalsByGroup };
}

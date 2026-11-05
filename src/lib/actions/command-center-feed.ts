import { createClient } from "@/lib/supabase/server";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";
import {
  getRateVisibility,
  maskTimeEntryRates,
} from "@/lib/auth/rate-visibility";
import type {
  ActionCardData,
  FeedItem,
  FeedLiveShift,
  RoleId,
} from "@/components/field-feed/command-center-feed";
import { getCommandCenterUpdatesPage } from "@/lib/actions/command-center-updates";
import type { CommandCenterUpdatesPage } from "@/lib/feed/command-center-updates";
import { getPendingDecisions } from "@/lib/actions/decisions";

const TZ = "America/New_York";

function nowET(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).replace(/^0/, "");
}

type TodoRow = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  contact_name: string;
  contact_type: string;
  description: string;
  status: "open" | "done" | "snoozed";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  category: string;
  ai_summary: string | null;
};

export async function getCommandCenterFeedData(
  role: RoleId,
  // Effective viewer id (the impersonated profile's id when "Viewing as"
  // someone, otherwise the signed-in user). The "Your Day" strip is a personal
  // surface and must be scoped to THIS id — see the scoped query below.
  viewerId: string,
): Promise<{ feed: FeedItem[]; initialUpdates: CommandCenterUpdatesPage | null }> {
  const supabase = await createClient();

  const now = nowET();
  const today = startOfDay(now);

  const safe = <T>(b: PromiseLike<{ data: T | null; error: unknown }>) =>
    Promise.resolve(b).catch(() => ({ data: null as T | null, error: true }));

  // head:true count queries — the popup buttons show true totals, not the
  // length of a capped list (which silently pinned at 12 forever).
  const safeCount = (
    b: PromiseLike<{ count: number | null; error: unknown }>,
  ) =>
    Promise.resolve(b)
      .then((r) => r.count ?? 0)
      .catch(() => 0);

  // Money tiles show THIS calendar week (Mon–Sun) — the exact same window and
  // math as the Finances Expenses/Income tabs, so the two never disagree.
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekAgoISO = monday.toISOString().slice(0, 10);

  const [
    initialUpdates,
    pendingDecisions,
    openShifts,
    todayClosedShifts,
    feedVis,
    myDatedTodosRes,
    depositsWeekRes,
    receiptsWeekRes,
    receiptFlaggedCount,
    depositFlaggedCount,
  ] = await Promise.all([
    // Independent requests start together. No project schedules or photo signing
    // hold up the first 20 posts; the desktop rail loads separately on demand.
    // Null keeps a failed initial page retryable instead of ending history.
    getCommandCenterUpdatesPage(null).catch(() => null),
    getPendingDecisions().catch(() => []),
    fetchTimeEntriesCompat(supabase, { open: true }).catch(() => []),
    fetchTimeEntriesCompat(supabase, { open: false, since: today.toISOString() }).catch(() => []),
    getRateVisibility(),
    // "Your Day" is a PERSONAL surface — only the viewer's own dated todos.
    // Scoped by created_by so impersonation ("Viewing as …") shows THEIR items,
    // not the impersonator's. (RLS can't do this: it sees the real auth.uid(),
    // never the impersonation cookie, and todos are otherwise shared team data.)
    safe<Pick<TodoRow, "id" | "description" | "priority" | "due_date">[]>(
      supabase
        .from("todos")
        .select("id, description, priority, due_date")
        .eq("status", "open")
        .eq("created_by", viewerId)
        .not("due_date", "is", null)
        .order("due_date", { ascending: true }),
    ),
    // Money IN over the last week — the Deposits tile's headline number.
    safe<{ amount: number | null }[]>(
      supabase
        .from("payments_received")
        .select("amount")
        .gte("received_date", weekAgoISO),
    ),
    // Money OUT over the last week — the Expenses tile's headline number.
    // Counts the same way the Finances pages do (cash view): paid rows only,
    // page formula paid_amount||amount, and the capital_one/internal markers
    // sit out — card charges count at payoff, labor placeholders via ADP.
    safe<{ amount: number | null; paid_amount: number | null; payment_method: string | null }[]>(
      supabase
        .from("invoices")
        .select("amount, paid_amount, payment_method").is("non_job_reason", null)
        .eq("payment_status", "paid")
        .gte("invoice_date", weekAgoISO),
    ),
    // Anything the AI wasn't sure about outranks the week number on both tiles:
    // a flagged row is work waiting, a week total is just information.
    safeCount(
      supabase
        .from("invoices")
        .select("id", { count: "exact", head: true }).is("non_job_reason", null)
        .eq("review_status", "needs_review"),
    ),
    safeCount(
      supabase
        .from("payments_received")
        .select("id", { count: "exact", head: true })
        .eq("review_status", "needs_review"),
    ),
  ]);

  const depositsWeekTotal = (depositsWeekRes.data ?? []).reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  );
  const receiptsWeekTotal = (receiptsWeekRes.data ?? [])
    .filter(row => row.payment_method !== "capital_one" && row.payment_method !== "internal")
    .reduce((sum, row) => sum + Number(row.paid_amount || row.amount || 0), 0);

  const hideFinances = role === "crew" || role === "lead";

  // ── Today strip ("Your Day") ───────────────────────────────────
  // Only the viewer's own todos due today — sourced from the created_by-scoped
  // query above, NOT the shared team todo list, so a teammate's personal items
  // never leak into another user's day.
  const todayEnd = new Date(today);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const todayTodos = (myDatedTodosRes.data ?? []).filter((t) => {
    if (!t.due_date) return false;
    const d = new Date(t.due_date);
    return d >= today && d < todayEnd;
  });

  const todayItem: FeedItem | null = todayTodos.length
    ? {
        type: "today",
        events: todayTodos.slice(0, 6).map((t) => ({
          time: fmtTime(t.due_date!),
          what: t.description,
          tag: t.priority === "urgent" ? "urgent" : t.priority === "high" ? "high" : "normal",
          done: false,
        })),
      }
    : null;

  // ── Decision cards (AI-proposed actions awaiting approval) ─────
  const decisionCards: ActionCardData[] = pendingDecisions.map((d) => {
    const eyebrowMap: Record<string, string> = {
      add_schedule_phase: "Schedule · Confirm phase",
      delete_schedule_phase: "Schedule · Confirm delete",
      link_quote_to_line: "Quote · Confirm budget line",
      link_invoice_to_line: "Invoice · Confirm budget line",
    };
    const lines: string[] = [];
    if (d.context) lines.push(d.context);
    return {
      type: "action",
      id: `decision-${d.id}`,
      priority: "high",
      kind: "decision",
      eyebrow: eyebrowMap[d.decision_type] ?? "AI · Needs review",
      title: d.title,
      lines: lines.length ? lines : undefined,
      primary: { label: "Confirm", icon: "check" },
      secondary: { label: "Reject", icon: "x" },
      decisionId: d.id,
    };
  });

  // ── Live map tile (replaces the email tile) ────────────────────
  // Only the ticking badge numbers ride in the feed — the map itself lives on
  // /command-center/map (see getLiveMapData in live-map.ts).
  // Finished shifts today are a fixed cost; open shifts tick client-side.
  let completedTodayCents = 0;
  for (const entry of todayClosedShifts) {
    if (!entry.clock_out) continue;
    const ms = new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime();
    if (ms <= 0) continue;
    const rate = entry.employees?.hourly_rate ?? 0;
    completedTodayCents += Math.round((ms / 3_600_000) * rate * 100);
  }

  // Per-shift rates are masked for viewers outside the office-rate set
  // (aggregate completedTodayCents above stays true).
  const activeShifts: FeedLiveShift[] = maskTimeEntryRates(
    feedVis,
    openShifts,
  ).map((entry) => ({
    id: entry.id,
    name: entry.employees
      ? `${entry.employees.first_name} ${entry.employees.last_name}`
      : "Unknown",
    clockIn: entry.clock_in,
    rateCentsPerHour: Math.round((entry.employees?.hourly_rate ?? 0) * 100),
    projectName: entry.projects?.name ?? null,
  }));

  // ── Assemble feed ──────────────────────────────────────────────
  const feed: FeedItem[] = [];

  feed.push({
    type: "liveMap",
    activeShifts,
    completedTodayCents,
    showSpend: !hideFinances,
  });
  // Money out, then money in. These replaced the Todos and Walkthroughs tiles:
  // both of those are lists you go read, while these two are the things anyone
  // on the team actually needs to DO from their phone the moment paper changes
  // hands. Todos still live at /command-center/todos and walkthroughs at
  // /walkthroughs — both still in the nav and in global search.
  feed.push({
    type: "receiptCapture",
    weekTotal: receiptsWeekTotal,
    flaggedCount: receiptFlaggedCount,
  });
  feed.push({
    type: "depositCapture",
    weekTotal: depositsWeekTotal,
    flaggedCount: depositFlaggedCount,
  });

  if (todayItem) feed.push(todayItem);

  // Keep approvals as an ordinary labeled section. Map, todos, and walkthroughs
  // have dedicated popup cards, so the old tab strip is gone. (The email tile
  // was retired in favor of the live map — email still syncs in the background
  // and stays reachable at /command-center/emails.)
  if (decisionCards.length > 0) {
    feed.push({ type: "section", label: "AI approvals" });
    feed.push(...decisionCards);
  }

  return { feed, initialUpdates };
}

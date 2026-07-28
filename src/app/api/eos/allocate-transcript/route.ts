import { NextResponse } from "next/server";
import { z } from "zod";
import { callClaude, nowStamp } from "@/lib/ai/claude";
import {
  getEosContext,
  listIssues,
  listMeasurables,
  listRocks,
  listTodos,
} from "@/lib/eos/queries";
import { l10Section, recentWeeks, weekEnding } from "@/lib/constants/eos";
import {
  EMPTY_ALLOCATION,
  SECTION_OUTPUTS,
  type MeetingAllocation,
} from "@/lib/eos/allocation";

/**
 * Turn what was said in one Level 10 section into filled-in EOS records.
 *
 * The team runs the meeting out loud; this reads the transcript and works out
 * who said what and where it belongs — Nicole's segue onto Nicole's row, a
 * number onto the right measurable, "that one's off track" onto the right
 * Rock, an action item into a to-do with an owner.
 *
 * Returns PROPOSALS only. Nothing is written to EOS tables here.
 */

const requestSchema = z.object({
  meetingId: z.string().uuid(),
  sectionKey: z.string().trim().min(1).max(40),
  transcript: z.string().trim().min(1, "Nothing was recorded yet.").max(24000),
});

const BASE_RULES = `You are transcribing and filing a Level 10 Meeting for Penney Construction, a residential general contractor running on EOS.

You are given the raw speech-to-text of ONE agenda section, plus the team roster and the live EOS records. Work out what the team decided and map it onto the real records by id.

Hard rules:
- Use ONLY ids that appear in the context below. Never invent an id. If something was discussed that has no matching record, propose it as a NEW item instead.
- Speech-to-text is messy: it drops punctuation, mangles names and mis-hears numbers. Read for intent. "Nicoles" / "Nicole S" / "the call" near her turn all mean Nicole.
- Match spoken names to the roster by first name where unambiguous. If you genuinely cannot tell who was speaking, set the profile id to null and put what you heard in the spoken name field.
- Do NOT invent content. If a person never spoke in this section, do not produce a row for them. Better to return fewer, correct items than to guess.
- Numbers: strip "dollars", "percent", "thousand" etc. and return a plain number. "two hundred and fifty thousand" -> 250000. "twenty two five" in a dollar context -> 22500. If a number is genuinely ambiguous, omit it.
- Keep to-do and issue titles short and action-first, the way the person said it.
- Return ONLY a JSON object. No prose, no preamble, no markdown fences.`;

const SECTION_GUIDANCE: Record<string, string> = {
  segue:
    `This is the SEGUE: each person gives one personal best and one business best from the last 7 days.
Produce one "segues" entry per person who actually spoke. personalBest = the personal/home one, businessBest = the work one. If they only gave one, put it in the right field and leave the other null.`,
  scorecard:
    `This is the SCORECARD read: owners read their weekly numbers out loud, nothing is discussed.
Produce "scores" entries matching each number to a measurable id. Also produce "newIssues" for anything the team explicitly said should go on the issues list because a number missed.`,
  rocks:
    `This is the ROCK REVIEW: each owner says on-track, off-track, or done. No discussion.
Produce "rockStatuses". Use "complete" only if they clearly said it is finished/done. Produce "newIssues" for any Rock they said should be dropped on the issues list.`,
  headlines:
    `These are CUSTOMER and EMPLOYEE HEADLINES — one-liners, good or bad.
Produce "headlines" with kind customer or employee. If a headline clearly needs action, also produce a "newTodos" or "newIssues" entry for it.`,
  todos:
    `This is the TO-DO review: last week's to-dos are called done or not done, no discussion.
Produce "todoStatuses" against existing to-do ids ("done" or "open"). Produce "newTodos" for any new commitment made. If a not-done to-do was escalated, add a "newIssues" entry.`,
  ids: `This is IDS — Identify, Discuss, Solve. This is where the real conversation happens.
Produce "newIssues" for problems raised that are not already on the list. Produce "solvedIssues" (with the solution the team agreed) for issues they worked through and closed. Produce "newTodos" for every action someone committed to — in EOS a solve almost always leaves a to-do behind, so look hard for who agreed to do what by when.`,
  conclude:
    `This is the CONCLUDE: recap, cascading message, and everyone rates the meeting 1-10.
Produce "cascadingMessage" if they agreed what to communicate to the rest of the company. Produce "ratings" for each person who said a number. Produce "newTodos" for anything committed at the end.`,
};

const SHAPE = `Return this JSON object, including ONLY the keys listed as allowed for this section. Omit or empty-array anything not heard.

{
  "summary": "one sentence on what you heard",
  "segues":        [{ "profileId": "uuid|null", "spokenName": "string", "personalBest": "string|null", "businessBest": "string|null" }],
  "scores":        [{ "measurableId": "uuid", "value": 0 }],
  "rockStatuses":  [{ "rockId": "uuid", "status": "on_track|off_track|complete" }],
  "headlines":     [{ "kind": "customer|employee", "body": "string" }],
  "todoStatuses":  [{ "todoId": "uuid", "status": "done|open" }],
  "newTodos":      [{ "title": "string", "ownerProfileId": "uuid|null", "dueDate": "YYYY-MM-DD|null" }],
  "newIssues":     [{ "title": "string", "description": "string|null", "ownerProfileId": "uuid|null", "term": "short_term|long_term" }],
  "solvedIssues":  [{ "issueId": "uuid", "solution": "string" }],
  "ratings":       [{ "profileId": "uuid|null", "spokenName": "string", "rating": 1 }],
  "cascadingMessage": "string|null"
}`;

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Narrow an unknown to one of a fixed set of literals. */
function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : null;
}

function str(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.toLowerCase() === "null") return null;
  return clean.slice(0, max);
}

export async function POST(request: Request) {
  try {
    const ctx = await getEosContext();
    if (!ctx) {
      return NextResponse.json({ error: "You are not on an EOS team." }, { status: 403 });
    }

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    const { meetingId, sectionKey, transcript } = parsed.data;

    const section = l10Section(sectionKey);
    if (!section) {
      return NextResponse.json({ error: "Unknown agenda section." }, { status: 400 });
    }

    // The meeting must belong to the caller's team.
    const { data: meeting } = await ctx.supabase
      .from("eos_meetings")
      .select("id, meeting_date")
      .eq("id", meetingId)
      .eq("team_id", ctx.team.id)
      .maybeSingle();
    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    }

    const week = weekEnding(new Date(`${meeting.meeting_date}T00:00:00Z`));
    const [rocks, measurables, todos, issues] = await Promise.all([
      listRocks(ctx),
      listMeasurables(ctx, recentWeeks(2, new Date(`${meeting.meeting_date}T00:00:00Z`))),
      listTodos(ctx, { status: "open" }),
      listIssues(ctx, { status: "open" }),
    ]);

    const allowed = SECTION_OUTPUTS[sectionKey] ?? [];

    const context = [
      `TEAM ROSTER (match spoken first names to these):`,
      ...ctx.people.map(
        (p) => `  ${p.id} = ${p.name}${p.seatLabel ? ` (${p.seatLabel})` : ""}`,
      ),
      ``,
      `ROCKS this quarter:`,
      ...(rocks.length
        ? rocks.map(
            (r) =>
              `  ${r.id} = "${r.title}" — owner ${r.ownerName ?? "unassigned"}, currently ${r.status}`,
          )
        : ["  (none)"]),
      ``,
      `SCORECARD MEASURABLES (week ending ${week}):`,
      ...(measurables.length
        ? measurables.map(
            (m) =>
              `  ${m.id} = "${m.name}" — owner ${m.ownerName ?? "unassigned"}, unit ${m.unit}, goal ${
                m.goalTarget === null ? "TBD" : `${m.comparison} ${m.goalTarget}`
              }`,
          )
        : ["  (none)"]),
      ``,
      `OPEN TO-DOS:`,
      ...(todos.length
        ? todos.map(
            (t) =>
              `  ${t.id} = "${t.title}" — owner ${t.ownerName ?? "unassigned"}${t.dueDate ? `, due ${t.dueDate}` : ""}`,
          )
        : ["  (none)"]),
      ``,
      `OPEN ISSUES:`,
      ...(issues.length
        ? issues.map(
            (i) => `  ${i.id} = "${i.title}" — owner ${i.ownerName ?? "unassigned"}, ${i.term}`,
          )
        : ["  (none)"]),
    ].join("\n");

    const system = [
      `Current date & time: ${nowStamp()}`,
      ``,
      BASE_RULES,
      ``,
      `SECTION: ${section.label}`,
      SECTION_GUIDANCE[sectionKey] ?? "",
      ``,
      `Allowed output keys for this section: ${allowed.join(", ") || "summary only"}. Anything else must be omitted.`,
      ``,
      SHAPE,
      ``,
      `--- LIVE EOS CONTEXT ---`,
      context,
    ].join("\n");

    const raw = await callClaude(system, `TRANSCRIPT:\n${transcript}`, 3000);

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw.replace(/^```json\s*|^```\s*|\s*```$/g, "").trim());
    } catch (err) {
      console.error("[eos/allocate] bad JSON:", err, "raw:", raw.slice(0, 400));
      return NextResponse.json(
        { error: "The AI returned something unreadable — try Fill again." },
        { status: 502 },
      );
    }

    // Everything below is id-validated against what we actually loaded, so a
    // hallucinated uuid can never reach an apply.
    const peopleIds = new Set(ctx.people.map((p) => p.id));
    const rockById = new Map(rocks.map((r) => [r.id, r]));
    const measurableById = new Map(measurables.map((m) => [m.id, m]));
    const todoById = new Map(todos.map((t) => [t.id, t]));
    const issueById = new Map(issues.map((i) => [i.id, i]));

    const arr = (key: string): Record<string, unknown>[] => {
      if (!allowed.includes(key)) return [];
      const v = obj[key];
      return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
    };
    const person = (v: unknown): string | null =>
      typeof v === "string" && peopleIds.has(v) ? v : null;

    const out: MeetingAllocation = {
      ...EMPTY_ALLOCATION,
      summary: str(obj.summary, 400),

      segues: arr("segues")
        .map((s) => ({
          profileId: person(s.profileId),
          spokenName: str(s.spokenName, 120) ?? "",
          personalBest: str(s.personalBest),
          businessBest: str(s.businessBest),
        }))
        .filter((s) => s.personalBest || s.businessBest),

      scores: arr("scores")
        .map((s) => {
          const m = typeof s.measurableId === "string" ? measurableById.get(s.measurableId) : undefined;
          const value = num(s.value);
          return m && value !== null
            ? { measurableId: m.id, measurableName: m.name, value }
            : null;
        })
        .filter((s): s is NonNullable<typeof s> => s !== null),

      rockStatuses: arr("rockStatuses")
        .map((r) => {
          const rock = typeof r.rockId === "string" ? rockById.get(r.rockId) : undefined;
          const status = oneOf(r.status, ["on_track", "off_track", "complete"] as const);
          return rock && status
            ? { rockId: rock.id, rockTitle: rock.title, status }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),

      headlines: arr("headlines")
        .map((h) => {
          const body = str(h.body, 600);
          const kind = h.kind === "employee" ? "employee" as const : "customer" as const;
          return body ? { kind, body } : null;
        })
        .filter((h): h is NonNullable<typeof h> => h !== null),

      todoStatuses: arr("todoStatuses")
        .map((t) => {
          const todo = typeof t.todoId === "string" ? todoById.get(t.todoId) : undefined;
          const status = t.status === "done" ? "done" as const : "open" as const;
          return todo ? { todoId: todo.id, title: todo.title, status } : null;
        })
        .filter((t): t is NonNullable<typeof t> => t !== null),

      newTodos: arr("newTodos")
        .map((t) => {
          const title = str(t.title, 300);
          const ownerProfileId = person(t.ownerProfileId);
          const due = str(t.dueDate, 10);
          return title
            ? {
                title,
                ownerProfileId,
                ownerName:
                  ctx.people.find((p) => p.id === ownerProfileId)?.name ?? null,
                dueDate: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
              }
            : null;
        })
        .filter((t): t is NonNullable<typeof t> => t !== null),

      newIssues: arr("newIssues")
        .map((i) => {
          const title = str(i.title, 300);
          const ownerProfileId = person(i.ownerProfileId);
          return title
            ? {
                title,
                description: str(i.description, 3000),
                ownerProfileId,
                ownerName:
                  ctx.people.find((p) => p.id === ownerProfileId)?.name ?? null,
                term: i.term === "long_term" ? ("long_term" as const) : ("short_term" as const),
              }
            : null;
        })
        .filter((i): i is NonNullable<typeof i> => i !== null),

      solvedIssues: arr("solvedIssues")
        .map((s) => {
          const issue = typeof s.issueId === "string" ? issueById.get(s.issueId) : undefined;
          const solution = str(s.solution, 3000);
          return issue && solution
            ? { issueId: issue.id, title: issue.title, solution }
            : null;
        })
        .filter((s): s is NonNullable<typeof s> => s !== null),

      ratings: arr("ratings")
        .map((r) => {
          const rating = num(r.rating);
          return rating !== null && rating >= 1 && rating <= 10
            ? {
                profileId: person(r.profileId),
                spokenName: str(r.spokenName, 120) ?? "",
                rating: Math.round(rating),
              }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),

      cascadingMessage: allowed.includes("cascadingMessage")
        ? str(obj.cascadingMessage, 4000)
        : null,
    };

    // Bank the transcript + proposals so a reload mid-meeting loses nothing.
    await ctx.supabase.from("eos_meeting_transcripts").upsert(
      {
        meeting_id: meetingId,
        section_key: sectionKey,
        transcript,
        proposals: out as unknown as Record<string, unknown>,
        proposed_at: new Date().toISOString(),
        created_by: ctx.viewerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "meeting_id,section_key" },
    );

    return NextResponse.json({ allocation: out });
  } catch (err) {
    console.error("[eos/allocate] failed:", err);
    return NextResponse.json(
      { error: "AI is temporarily unavailable — try again in a moment." },
      { status: 503 },
    );
  }
}

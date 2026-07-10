import { NextResponse } from "next/server";
import { z } from "zod";
import { callClaude } from "@/lib/ai/claude";
import { listActivityMentions } from "@/lib/actions/activity-mentions";
import { parseClaudeJSON } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  projectId: z.string().uuid().optional(),
});

const responseSchema = z.object({
  ids: z.array(z.string().uuid()).max(20),
});

function normalizedWords(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function deterministicMatches(
  text: string,
  workers: Awaited<ReturnType<typeof listActivityMentions>>,
): string[] {
  const textWords = new Set(normalizedWords(text));
  return workers
    .filter((worker) => {
      const labelWords = normalizedWords(worker.label);
      const firstName = labelWords[0];
      return (
        textWords.has(worker.token.toLowerCase()) ||
        (Boolean(firstName) &&
          textWords.has(firstName) &&
          workers.filter(
            (candidate) => normalizedWords(candidate.label)[0] === firstName,
          ).length === 1)
      );
    })
    .map((worker) => worker.id);
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const mentions = await listActivityMentions(parsed.data.projectId);
    const workers = mentions.filter(
      (mention) => mention.type === "worker" && mention.profileId,
    );
    if (workers.length === 0) return NextResponse.json({ mentionIds: [] });

    const exactIds = deterministicMatches(parsed.data.text, workers);
    if (exactIds.length > 0) {
      return NextResponse.json({ mentionIds: exactIds });
    }

    const catalog = workers.map((worker) => ({
      id: worker.id,
      name: worker.label,
      token: worker.token,
    }));
    const result = await callClaude(
      `Match people explicitly referred to in a construction update against the provided team catalog.
Speech recognition may have slightly misspelled a name. Only match when the spoken name is reasonably clear.
Never infer people from the work described. Return JSON only: {"ids":["catalog-uuid"]}. Return {"ids":[]} when uncertain.`,
      `TEAM CATALOG:\n${JSON.stringify(catalog)}\n\nUPDATE:\n${parsed.data.text}`,
      300,
    );
    const aiResult = responseSchema.safeParse(parseClaudeJSON<unknown>(result));
    if (!aiResult.success) return NextResponse.json({ mentionIds: [] });

    const allowedIds = new Set(workers.map((worker) => worker.id));
    const mentionIds = Array.from(
      new Set(aiResult.data.ids.filter((id) => allowedIds.has(id))),
    );
    return NextResponse.json({ mentionIds });
  } catch (error) {
    console.error("[match-activity-mentions] failed", error);
    return NextResponse.json({ mentionIds: [] });
  }
}

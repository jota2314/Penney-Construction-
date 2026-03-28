import { NextResponse } from "next/server";
import { callClaude } from "@/lib/ai/claude";

const SYSTEM_PROMPT = `You are a senior residential construction estimator conducting a post-walkthrough review. After reading the meeting summary and notes from a client walkthrough, you need to identify what SPECIFIC information is still missing to create an accurate estimate.

Generate targeted follow-up questions that fill in gaps. Focus on:

DIMENSIONS: Square footage of rooms, wall lengths, ceiling heights, opening sizes
MATERIALS: Specific material selections (tile type, countertop material, flooring, cabinet grade, fixture brands)
FIXTURES: Number and type of plumbing fixtures, electrical outlets/switches, light fixtures, appliances
STRUCTURAL: Load-bearing walls, beam requirements, foundation work, roof modifications
SCOPE: Exact boundaries of work (which rooms, what stays/goes, permit requirements)
BUDGET: Material tier preferences (builder grade, mid-grade, high-end)
TIMELINE: Any deadlines, phasing needs, occupancy during construction

Rules:
- Only ask questions where the answer is NOT already in the meeting summary/notes
- Each question must be specific and answerable in a short response
- Categorize each question: dimensions, materials, fixtures, structural, scope, budget, timeline, general
- Ask 6-12 questions depending on how much info is missing
- Order from most important (dimensions, structural) to least (timeline, general)
- Do NOT ask open-ended questions like "tell me more about..." — ask specific measurable questions
- Frame questions so answers can directly feed into pricing (e.g., "How many recessed lights?" not "What kind of lighting?")

Respond with valid JSON:
{
  "questions": [
    {
      "question": "What is the approximate square footage of the kitchen?",
      "category": "dimensions"
    }
  ]
}`;

export async function POST(request: Request) {
  try {
    const { meetingSummary, meetingNotes, projectType, clientName, address } =
      await request.json();

    if (!meetingSummary && !meetingNotes) {
      return NextResponse.json(
        { error: "Meeting summary or notes required" },
        { status: 400 }
      );
    }

    const contextParts: string[] = [];
    if (clientName) contextParts.push(`Client: ${clientName}`);
    if (projectType) contextParts.push(`Project type: ${projectType}`);
    if (address) contextParts.push(`Address: ${address}`);

    if (meetingSummary) {
      contextParts.push(`\nMeeting Summary:\n${meetingSummary}`);
    }

    if (meetingNotes) {
      contextParts.push(`\nRaw Meeting Notes:\n${meetingNotes}`);
    }

    const userMessage = `Review this walkthrough and generate follow-up questions to fill in missing details for an accurate estimate:\n\n${contextParts.join("\n")}`;

    const raw = await callClaude(SYSTEM_PROMPT, userMessage, 1500);

    let parsed: {
      questions?: { question: string; category: string }[];
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid JSON" },
        { status: 500 }
      );
    }

    const validCategories = [
      "dimensions",
      "materials",
      "fixtures",
      "structural",
      "scope",
      "budget",
      "timeline",
      "general",
    ];

    const questions = (parsed.questions ?? [])
      .filter(
        (q) =>
          typeof q.question === "string" && q.question.trim().length > 0
      )
      .map((q, i) => ({
        question: q.question.trim(),
        category: validCategories.includes(q.category)
          ? q.category
          : "general",
        sort_order: i,
      }));

    return NextResponse.json({ questions });
  } catch (error) {
    console.error("generate-project-questions error:", error);
    return NextResponse.json(
      { error: "Failed to generate questions" },
      { status: 500 }
    );
  }
}

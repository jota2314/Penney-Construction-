import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { trade, location } = await request.json();
    if (!trade) {
      return NextResponse.json({ error: "trade is required" }, { status: 400 });
    }

    const area = location || "North Shore MA (Beverly, Peabody, Salem, Danvers, Marblehead area)";

    const systemPrompt = `You are a construction subcontractor researcher. Given a trade and location, return a JSON array of subcontractors that would be good candidates for residential construction work in that area.

For each contractor, return:
{
  "company_name": "string",
  "contact_name": "string or null",
  "phone": "string or null",
  "email": "string or null",
  "website": "string or null",
  "city": "string",
  "state": "MA",
  "trades": ["string"],
  "notes": "brief note about why they'd be good (reviews, specialties, etc.)"
}

Rules:
- Return 5-10 realistic contractors for the trade and area
- Focus on residential specialists, not large commercial outfits
- Include a mix of well-known and smaller shops
- If you know specific real companies in that area, include them
- If you don't know specific companies, generate realistic entries based on typical North Shore MA contractor profiles
- Always include the trade requested in the trades array
- Return ONLY the JSON array, no other text`;

    const userMessage = `Find ${trade} contractors near ${area} for residential construction projects.`;

    const raw = await callClaude(`Current date: ${nowStamp()}\n\n${systemPrompt}`, userMessage, 2000);

    // Parse the JSON response
    let contractors;
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      contractors = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "Failed to parse contractor data" }, { status: 500 });
    }

    return NextResponse.json({ contractors, trade, location: area });
  } catch (error) {
    console.error("find-subs error:", error);
    return NextResponse.json({ error: "Failed to find subcontractors" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { trade, location, page = 1 } = await request.json();
    if (!trade) {
      return NextResponse.json({ error: "trade is required" }, { status: 400 });
    }

    const area = location || "North Shore Massachusetts (Beverly, Peabody, Salem, Danvers, Gloucester, Marblehead, Swampscott, Lynn, Essex area)";

    // Get existing subs to avoid duplicates
    const { data: existingSubs } = await supabase
      .from("subcontractors")
      .select("company_name, email")
      .eq("is_active", true);

    const existingNames = (existingSubs ?? []).map((s) => s.company_name.toLowerCase());

    const systemPrompt = `You are a construction subcontractor researcher for Penney Construction, a residential GC on the North Shore of Massachusetts.

Your job is to find REAL subcontractor companies that do ${trade} work in the ${area} area.

Research and return REAL companies. Think about:
- Local trade contractors who serve the North Shore MA area
- Companies that do residential work (remodels, additions, kitchens, bathrooms)
- Include a mix: some well-established, some smaller shops
- For each company, provide whatever contact info you can find
- Rate them 1-5 on likely fit for a residential GC

These companies ALREADY exist in the database, so DO NOT suggest them:
${existingNames.slice(0, 20).join(", ")}

Page ${page}: ${page === 1 ? "Give the top 8 most relevant results" : `Give results ${(page - 1) * 8 + 1}-${page * 8} (different from previous pages)`}.

Return a JSON array. Each entry:
{
  "company_name": "Real Company Name",
  "contact_name": null,
  "phone": "phone if known, or null",
  "email": "email if known, or null",
  "website": "website if known, or null",
  "city": "city",
  "state": "MA",
  "trades": ["${trade}"],
  "rating": 4,
  "notes": "Brief note: what they specialize in, reviews, why good fit"
}

Return ONLY the JSON array, no other text. If you cannot find 8, return as many as you can.`;

    const userMessage = `Find ${trade} contractors near ${area} for residential construction. Page ${page}.`;

    const raw = await callClaude(`Current date: ${nowStamp()}\n\n${systemPrompt}`, userMessage, 3000);

    let contractors;
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      contractors = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "Failed to parse results" }, { status: 500 });
    }

    // Filter out any that match existing subs
    const filtered = contractors.filter(
      (c: { company_name: string }) => !existingNames.includes(c.company_name.toLowerCase())
    );

    return NextResponse.json({ contractors: filtered, trade, location: area, page });
  } catch (error) {
    console.error("find-subs error:", error);
    return NextResponse.json({ error: "Failed to find subcontractors" }, { status: 500 });
  }
}

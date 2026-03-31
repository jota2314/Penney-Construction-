import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";
import { UNIT_LABELS } from "@/lib/constants/company";

function buildSystemPrompt(
  tradeRates?: { trade_name: string; unit_type: string; avg_price: number }[]
) {
  let pricingSection = "";

  if (tradeRates && tradeRates.length > 0) {
    const lines = tradeRates.map(
      (r) =>
        `- ${r.trade_name}: $${r.avg_price.toFixed(2)}${UNIT_LABELS[r.unit_type] || ""}`
    );
    pricingSection = `

## Company Cost Book (USE THESE RATES)
These are the contractor's actual rates based on their market and experience. Use these as your PRIMARY pricing basis.
For each line item:
1. Estimate the QUANTITY from the project description (sqft of demo, number of fixtures, LF of trim, etc.)
2. Multiply quantity × the rate below to get total_price
3. If a trade is not listed, use your professional judgment for NE US market rates
4. For lump sum items, use the rate directly as the total_price
5. Include your quantity estimate in the scope bullets (e.g., "• Demolish approximately 200 sqft of existing kitchen")

${lines.join("\n")}`;
  }

  return `You are a senior residential construction estimator with 20+ years of experience creating complete estimates for residential remodeling and new construction projects in the northeastern United States.

Current date & time: ${nowStamp()}

Given a project description, type, square footage details, and optionally photos/drawings, generate a COMPLETE list of line items needed for the project.

Rules:
- Generate ALL trades and work items needed for the described work — do not skip anything
- Order items in construction sequence: demolition → structural → rough-ins (plumbing, electrical, HVAC) → insulation → drywall → finishes (tile, flooring, paint, trim) → fixtures/appliances → cleanup
- Include items homeowners commonly forget: permits, engineering/plans, temporary protection, dumpster/hauling, final cleaning
- For each line item, provide:
  - "description": short item name matching the trade names from the cost book when applicable (e.g., "Demolition", "Framing", "Electrical Rough-In")
  - "proposal_description": 5-10 bullet points starting with • describing the COMPLETE scope of work in professional proposal language. Each bullet must be specific and include:
    - Quantities and measurements (sqft, LF, number of fixtures, etc.)
    - Specific materials when known (quartz countertops, LVP flooring, R-19 batt insulation, etc.)
    - Exact locations (master bathroom, kitchen island, second floor, etc.)
    - What is included AND what the standard of work is (e.g., "level 4 drywall finish" not just "drywall")
  - "total_price": calculated from quantity × rate from the cost book. Show your math reasoning in scope bullets.

Scope of Work Writing Rules:
- Write like this will appear on a SIGNED CONTRACT — be thorough and specific
- Every bullet starts with • and describes a specific task or inclusion
- Include quantities: "• Demolish approximately 150 sqft of existing tile flooring" NOT "• Remove existing flooring"
- Include materials: "• Install 3/4-inch solid oak hardwood flooring" NOT "• Install new flooring"
- Include locations: "• Frame new 8-foot opening between kitchen and dining room with LVL header" NOT "• Frame new opening"
- Standard sub-tasks per trade must be included:
  - Framing: blocking, backing for TV/cabinets/grab bars, headers, Simpson ties/connectors
  - Demolition: what is being removed, protection of adjacent areas, debris hauling
  - Plumbing: rough-in, fixture install, supply lines, drain/waste/vent, shut-offs, testing
  - Electrical: rough-in, finish trim, dedicated circuits, fixture installation, code compliance
  - Drywall: hang, tape, mud, sand, prime — specify finish level
  - Tile: substrate prep, waterproofing/membrane, tile setting, grout, caulk, edge trim
  - Painting: surface prep, primer, number of coats, walls/ceilings/trim noted separately
- Do NOT use vague language like "as needed", "if applicable", "various", "miscellaneous"
- Do NOT include pricing or dollar amounts in the scope bullet points
- Do NOT include a project summary item — only construction work items
- If photos are provided, reference specific visible details (existing conditions, materials, layout)
${pricingSection}

Respond with valid JSON in this exact format:
{
  "lineItems": [
    {
      "description": "Item Name",
      "proposal_description": "• Bullet 1\\n• Bullet 2\\n• Bullet 3\\n• Bullet 4\\n• Bullet 5",
      "total_price": 5000
    }
  ]
}`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const {
      projectType,
      projectName,
      projectAddress,
      projectDescription,
      fileUrls,
      siteVisitNotes,
      meetingQA,
      tradeRates,
    } = await request.json();

    if (!projectDescription || typeof projectDescription !== "string" || !projectDescription.trim()) {
      return NextResponse.json(
        { error: "Project description is required" },
        { status: 400 }
      );
    }

    // Build user message with project context
    const contextParts: string[] = [];
    if (projectType) contextParts.push(`Project type: ${projectType}`);
    if (projectName) contextParts.push(`Project name: ${projectName}`);
    if (projectAddress) contextParts.push(`Location: ${projectAddress}`);
    contextParts.push(`\nProject description:\n${projectDescription.trim()}`);

    if (siteVisitNotes && typeof siteVisitNotes === "string" && siteVisitNotes.trim()) {
      contextParts.push(`\nSite visit notes (from on-site inspection):\n${siteVisitNotes.trim()}`);
    }

    if (meetingQA && typeof meetingQA === "string" && meetingQA.trim()) {
      contextParts.push(`\nClient Q&A (follow-up questions answered by the client after walkthrough):\n${meetingQA.trim()}\n\nIMPORTANT: Use these answers to fill in specific measurements, material selections, fixture counts, and other details that affect pricing.`);
    }

    let userMessage = `Generate a complete estimate for this residential construction project:\n\n${contextParts.join("\n")}\n\nIMPORTANT: For every line item, estimate quantities from the description (sqft, fixture count, LF, etc.) and calculate pricing using the cost book rates. Write detailed, contract-ready scope bullets with specific measurements, materials, and locations.`;

    // Add photo context if provided
    if (Array.isArray(fileUrls) && fileUrls.length > 0) {
      userMessage += `\n\n${fileUrls.length} site photo(s) were provided for reference.`;
    }

    const systemPrompt = buildSystemPrompt(
      Array.isArray(tradeRates) ? tradeRates : undefined
    );

    const raw = await callClaude(systemPrompt, userMessage, 6000);

    let parsed: { lineItems?: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid JSON" },
        { status: 500 }
      );
    }

    if (!Array.isArray(parsed.lineItems)) {
      return NextResponse.json(
        { error: "AI response missing lineItems array" },
        { status: 500 }
      );
    }

    // Validate and sanitize each line item
    const lineItems = parsed.lineItems
      .filter(
        (item): item is { description: string; proposal_description?: string; total_price?: number } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).description === "string" &&
          ((item as Record<string, unknown>).description as string).trim().length > 0
      )
      .map((item) => ({
        description: item.description.trim(),
        proposal_description:
          typeof item.proposal_description === "string"
            ? item.proposal_description.trim()
            : "",
        total_price:
          typeof item.total_price === "number" && item.total_price >= 0
            ? Math.round(item.total_price * 100) / 100
            : 0,
      }));

    return NextResponse.json({ lineItems });
  } catch (error) {
    console.error("generate-estimate error:", error);
    return NextResponse.json(
      { error: "Failed to generate estimate" },
      { status: 500 }
    );
  }
}

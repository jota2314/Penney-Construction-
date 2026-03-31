import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

const SYSTEM_PROMPT = `You are a senior residential construction estimator with 20+ years of experience writing scopes of work for signed contracts and proposals.

When given a line item name, project context, and optionally the estimator's verbal description, write a thorough and professional scope of work.

Rules:
- Use 5-10 concise bullet points starting with •
- Be SPECIFIC to the project type and context provided — a kitchen demolition scope is completely different from a bathroom demolition scope
- Every bullet must include SPECIFICS:
  - Quantities and measurements when estimable from context (sqft, LF, fixture count)
  - Materials by name (quartz, LVP, R-19 batt, 5/8" drywall, etc.)
  - Locations (master bath, kitchen island, second floor hallway, etc.)
  - Standard of work (level 4 finish, 2 coats, etc.)
- Include all standard sub-tasks that an experienced GC would include. For example:
  - Framing: blocking, backing for TV mounts/cabinets/grab bars, headers for openings, engineered lumber where required, Simpson ties/connectors, fire blocking
  - Demolition: specify what is being removed (cabinets, flooring, drywall, fixtures, etc.), protection of adjacent areas, debris hauling and disposal, disconnect utilities
  - Plumbing: rough-in, fixture installation, supply lines, drain/waste/vent, shut-off valves, testing, code inspection
  - Electrical: rough-in, finish trim, panels/subpanels if needed, dedicated circuits, low voltage/data, fixture installation, GFCI/AFCI where required
  - Drywall: hanging, taping, mudding, texture matching, sanding, primer coat — specify finish level (level 4 or 5)
  - Tile: substrate prep (cement board/Ditra), waterproofing/membrane in wet areas, tile setting, grout, caulk at transitions, edge trim (Schluter or similar)
  - Painting: surface prep (fill, sand, caulk), primer where needed, 2 coats finish paint, specify walls/ceilings/trim separately
  - Cabinetry: delivery, set and level, shim, secure to wall, adjust doors/drawers, hardware install
  - Countertops: template, fabrication, installation, seaming, cutouts for sink/cooktop, backsplash if applicable
- Write like this will appear on a SIGNED CONTRACT — be thorough and professional
- If the estimator provided a verbal description, use their specific details as the primary basis. Keep everything they mentioned, add standard items they may have missed, and rewrite in professional language.
- Do NOT include any pricing, dollar amounts, or cost references
- Do NOT include a title, header, or the line item name — just the bullet points
- Do NOT use vague language like "as needed", "if applicable", "various", "miscellaneous" — be definitive`;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const {
      itemName,
      dictation,
      projectType,
      projectName,
      projectAddress,
      projectOverview,
    } = await request.json();

    if (!itemName || typeof itemName !== "string" || !itemName.trim()) {
      return NextResponse.json(
        { error: "itemName is required" },
        { status: 400 }
      );
    }

    // Build project context string
    const contextParts: string[] = [];
    if (projectType) contextParts.push(`Project type: ${projectType}`);
    if (projectName) contextParts.push(`Project name: ${projectName}`);
    if (projectAddress) contextParts.push(`Location: ${projectAddress}`);
    if (projectOverview) contextParts.push(`Project overview: ${projectOverview}`);
    const projectContext = contextParts.length > 0
      ? `\n\nProject context:\n${contextParts.join("\n")}`
      : "";

    // Build user message
    let userMessage = `Write a scope of work for the line item: "${itemName.trim()}"`;
    if (dictation) {
      userMessage += `\n\nThe estimator described this work verbally as:\n"${dictation}"`;
      userMessage += "\n\nUse their description as the primary basis — keep every specific detail they mentioned, add standard items they may have missed, and rewrite everything in professional proposal language.";
    }
    userMessage += projectContext;
    userMessage += "\n\nWrite specific, contract-ready bullet points with quantities, materials, and locations. No vague language.";

    const scope = await callClaude(`Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPT}`, userMessage, 700);

    return NextResponse.json({ scope });
  } catch (error) {
    console.error("generate-scope error:", error);
    return NextResponse.json(
      { error: "Failed to generate scope" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_OPUS_FALLBACK, nowStamp, logAiUsage } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 300;

// ===========================================================================
// Shared types
// ===========================================================================

type SourceType = "dimension_string" | "schedule_row" | "callout" | "computed" | "note" | "visible_on_plan";
type Confidence = "high" | "medium" | "low" | "none";

interface ScopeItem {
  id: string;
  trade: string;                 // slug key — must be one of REQUIRED_TRADES
  description: string;
  quantity: number | null;        // null when needs quote
  unit: string | null;            // null when needs quote
  materialSpec?: string;          // "2x6 studs @ 16\" OC", "R-21 cellulose", etc.
  sourceSheet?: string;
  sourceType?: SourceType;
  sourceDetail?: string;
  computation?: string;
  confidence: Confidence;
  needsQuote: boolean;
  notes?: string;
}

interface ScheduleWindow { tag?: string; manufacturer?: string; model?: string; size?: string; count: number; sourceSheet?: string; notes?: string; }
interface ScheduleDoor { tag?: string; type?: string; size?: string; count: number; sourceSheet?: string; notes?: string; }
interface ScheduleStructural { tag?: string; type: string; size: string; span?: string; count: number; sourceSheet?: string; notes?: string; }
interface ScheduleFinish { room?: string; floor?: string; walls?: string; ceiling?: string; sourceSheet?: string; }

interface PageResult {
  pageNumber: number;
  sheetNumber?: string;
  sheetTitle?: string;
  sheetPurpose?: string;
  scope: ScopeItem[];
  schedules: {
    windows?: ScheduleWindow[];
    doors?: ScheduleDoor[];
    structural?: ScheduleStructural[];
    finishes?: ScheduleFinish[];
  };
  notes?: string[];
  missing?: { item: string; whyNeeded: string; suggestedSource: string }[];
}

// ===========================================================================
// The 22 required residential-GC trades. Display order = scope order.
// ===========================================================================

const REQUIRED_TRADES: { key: string; label: string; description: string }[] = [
  { key: "demolition",     label: "Demolition",              description: "Removal of existing walls, finishes, fixtures" },
  { key: "sitework",       label: "Site Work",               description: "Excavation, grading, drainage, compaction" },
  { key: "concrete",       label: "Concrete",                description: "Footings, foundation walls, slabs, piers" },
  { key: "framing",        label: "Framing",                 description: "Dimensional lumber: studs, plates, joists, rafters" },
  { key: "lvl_steel",      label: "LVL / Steel / Engineered", description: "Engineered lumber, steel beams, columns, hangers" },
  { key: "sheathing",      label: "Sheathing",               description: "Wall and roof sheathing" },
  { key: "roofing",        label: "Roofing",                 description: "Shingles, underlayment, flashing, ridge vent, drip edge" },
  { key: "windows",        label: "Windows",                 description: "All windows per schedule" },
  { key: "exterior_doors", label: "Exterior Doors",          description: "Entry and sliding doors per schedule" },
  { key: "siding",         label: "Siding",                  description: "Siding material per elevations" },
  { key: "exterior_trim",  label: "Exterior Trim",           description: "Fascia, soffit, corner boards, window/door trim" },
  { key: "gutters",        label: "Gutters",                 description: "Gutters and downspouts" },
  { key: "insulation",     label: "Insulation",              description: "Wall, floor, and attic insulation per assembly notes" },
  { key: "drywall",        label: "Drywall",                 description: "Walls and ceilings, tape, mud, finish" },
  { key: "interior_doors", label: "Interior Doors",          description: "All interior doors per schedule" },
  { key: "interior_trim",  label: "Interior Trim",           description: "Casing, base, crown, chair rail" },
  { key: "flooring",       label: "Flooring",                description: "All flooring per finish schedule, room by room" },
  { key: "kitchen",        label: "Kitchen",                 description: "Cabinets, island, countertops, appliances, hood" },
  { key: "bathroom",       label: "Bathroom",                description: "Vanities, toilets, tubs, showers, tile, fixtures" },
  { key: "painting",       label: "Painting",                description: "Interior walls/ceilings, exterior, trim" },
  { key: "electrical",     label: "Electrical",              description: "Rough + fixtures + panel/service if noted" },
  { key: "plumbing",       label: "Plumbing",                description: "Rough + fixtures + water heater" },
  { key: "hvac",           label: "HVAC",                    description: "Equipment, ducts, zones per notes" },
];
const TRADE_KEYS = REQUIRED_TRADES.map(t => t.key);

// ===========================================================================
// Per-page prompt
// ===========================================================================

function perPageSystemPrompt(opts: {
  pageNumber: number;
  totalPages: number;
  projectInfo: string;
  scopeOfWork?: string;
  drawingText?: string;
  filename?: string;
}) {
  const tradeList = REQUIRED_TRADES
    .map(t => `  ${t.key}: ${t.label} — ${t.description}`)
    .join("\n");

  return `You are a senior residential construction estimator on the North Shore of Massachusetts. Current date: ${nowStamp()}.

You are analyzing ONE page of a ${opts.totalPages}-page drawing set. Your job is to produce a SCOPE OF WORK for any trades visible on THIS page, organized by trade, line-item by line-item.
${opts.projectInfo}
${opts.scopeOfWork ? `\nKnown scope: ${opts.scopeOfWork}` : ""}
${opts.drawingText ? `\nExtracted PDF text (may include this page's notes):\n${opts.drawingText.substring(0, 3000)}` : ""}
${opts.filename ? `\nFilename: ${opts.filename}` : ""}

You are looking at page ${opts.pageNumber} of ${opts.totalPages}.

===================================================================
THE JOB: build scope lines, not just dim readings
===================================================================
You're not a dim-string reader. You're a GC estimator. For every trade
visible on THIS page, output scope items that a subcontractor could
bid from.

Allowed trades (use these exact keys):
${tradeList}

Output rules per scope item:
- description: plain-English scope line ("Install 3/4\\" red oak hardwood in Living Room")
- quantity + unit: fill these ONLY if you can compute or read them from this page
    - Allowed units: LF, SF, sqft, ea, count, CY, cuft, sheets, LB
    - NEVER "lot" unless it is a true lump-sum contract amount
- materialSpec: the material/size/grade if noted ("R-21 cellulose", "5.25x14 LVL", "30-year arch shingle")
- sourceSheet: the sheet number this came from (e.g., "A101", "S1.0", or page number if no sheet tag)
- sourceType: dimension_string | schedule_row | callout | computed | note | visible_on_plan
- sourceDetail: the literal text/feature you read
- computation: the math, if applicable (e.g., "34.5 × 27.4 = 946")
- confidence: high | medium | low
- needsQuote: true if this item's qty can't be derived from this page (so a sub needs to quote from plans)
- notes: anything else a sub would want to know

===================================================================
DERIVATIONS YOU SHOULD DO (don't be lazy)
===================================================================
- Drywall walls SF = (interior wall LF, read or estimated from plan) × ceiling height (labeled or note 9' typical)
- Drywall ceilings SF = room SF or addition footprint SF
- Insulation walls SF = same as drywall walls
- Insulation attic SF = same as ceiling SF
- Flooring per room = room SF from labeled dims × finish schedule material
- Foundation LF = sum of exterior dims from foundation plan
- Foundation wall SF = perimeter × wall height
- Footings CY = perimeter × width × depth / 27
- Roof SF = footprint × pitch multiplier (6:12 = 1.118, 8:12 = 1.202, 12:12 = 1.414)
- Joists count = framed span LF / (OC spacing in / 12)
- Stud count = wall LF × 12 / OC spacing (16" = 0.75 studs/LF typical)
- Siding SF = elevation wall area minus openings (from window/door schedule)

If a derivation requires data that's NOT on this page, put the item with
quantity=null and needsQuote=true — do NOT skip it.

===================================================================
SCHEDULES — if this page has one, transcribe every row
===================================================================
Windows: { tag, manufacturer, model, size, count, sourceSheet }
Doors: { tag, type, size, count, sourceSheet }
Structural: { tag, type, size, span, count, sourceSheet }  — each LVL/PSL/steel member as its own row
Finishes: { room, floor, walls, ceiling, sourceSheet }

===================================================================
NEVER acceptable on output
===================================================================
- { "quantity": 1, "unit": "lot" } for anything other than a real lump sum
- Existence-confirmation rows like "Foundation wall details" / "Connection details shown on S2.0"
- Grid-square estimates ("estimated from plan grid")
- Vague members like "Engineered beam 1 ea" — transcribe the specific LVL/PSL/steel size + span
- Skipping a trade you can see on this page

===================================================================
OUTPUT — valid JSON only, no markdown fences
===================================================================
{
  "pageNumber": ${opts.pageNumber},
  "sheetNumber": "A101" or null,          // read from title block if visible
  "sheetTitle": "First Floor Plan" or null,
  "sheetPurpose": "short sentence",
  "scope": [
    { "trade": "foundation", "description": "...", "quantity": 129, "unit": "LF",
      "materialSpec": "10\\" poured concrete wall", "sourceSheet": "A101",
      "sourceType": "computed", "sourceDetail": "24'-6\\" + 40'-0\\" × 2",
      "computation": "24.5 + 40 + 24.5 + 40 = 129",
      "confidence": "high", "needsQuote": false, "notes": "" }
  ],
  "schedules": {
    "windows": [ { "tag": "W1", "size": "3040", "count": 4, "sourceSheet": "A101" } ],
    "doors": [ ... ],
    "structural": [ ... ],
    "finishes": [ ... ]
  },
  "notes": [ "Cover sheet general notes: insulation R-21 walls, R-49 attic" ],
  "missing": [ { "item": "Roof pitch", "whyNeeded": "needed for roof SF", "suggestedSource": "check elevation sheets" } ]
}

BE HONEST AND THOROUGH. Do not invent dims. But also do not skip trades
visible on this page just because some details are unclear — include the
item with needsQuote=true so it enters the bid package.`;
}

// ===========================================================================
// Orchestrator
// ===========================================================================

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { pages, filename, drawingText, scopeOfWork, projectId } = await request.json();

  if (!Array.isArray(pages) || pages.length === 0) {
    return NextResponse.json({ error: "No drawing pages provided" }, { status: 400 });
  }

  let projectInfo = "";
  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("name, address, project_type, scope_of_work")
      .eq("id", projectId)
      .single();
    if (project) {
      projectInfo = `\nProject: ${project.name}\nAddress: ${project.address || "N/A"}\nType: ${project.project_type || "residential"}\n${project.scope_of_work ? `Known scope: ${project.scope_of_work}` : ""}`;
    }
  }

  try {
    const anthropic = await getAnthropicClient();
    type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

    // -------- Per-page parallel calls --------
    const pageCalls = pages.map((page: { data: string; mediaType?: string; label?: string }, idx: number) => {
      const pageNumber = idx + 1;
      const systemPrompt = perPageSystemPrompt({
        pageNumber,
        totalPages: pages.length,
        projectInfo,
        scopeOfWork,
        drawingText,
        filename,
      });
      const mt = (page.mediaType || "image/jpeg") as MediaType;

      return (async (): Promise<PageResult | null> => {
        let responseText = "";
        let usedModel = "";
        for (const model of CLAUDE_OPUS_FALLBACK) {
          try {
            const response = await anthropic.messages.create({
              model,
              max_tokens: 8192,
              system: systemPrompt,
              messages: [{
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: mt, data: page.data } },
                  { type: "text", text: `Produce the scope JSON for page ${pageNumber}. Include every trade you can see on this sheet. Respond with JSON only.` },
                ],
              }],
            });
            usedModel = model;
            if (response.usage) {
              logAiUsage({
                userId: user.id,
                endpoint: "takeoff-full-analyze/page",
                model,
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                context: `p${pageNumber} ${filename || ""}`,
              });
            }
            responseText = response.content[0]?.type === "text" ? response.content[0].text : "";
            if (responseText) break;
          } catch (err) {
            console.error(`takeoff per-page ${model} p${pageNumber} error:`, err);
            continue;
          }
        }
        if (!responseText) return null;

        let jsonStr = responseText;
        const s = jsonStr.indexOf("{");
        const e = jsonStr.lastIndexOf("}");
        if (s !== -1 && e > s) jsonStr = jsonStr.substring(s, e + 1);
        try {
          const parsed = JSON.parse(jsonStr) as Partial<PageResult>;
          return {
            pageNumber,
            sheetNumber: parsed.sheetNumber,
            sheetTitle: parsed.sheetTitle,
            sheetPurpose: parsed.sheetPurpose,
            scope: Array.isArray(parsed.scope) ? parsed.scope : [],
            schedules: parsed.schedules || {},
            notes: Array.isArray(parsed.notes) ? parsed.notes : [],
            missing: Array.isArray(parsed.missing) ? parsed.missing : [],
          };
        } catch {
          console.error(`takeoff per-page p${pageNumber} non-JSON response`);
          return null;
        }
      })();
    });

    const pageResults: (PageResult | null)[] = await Promise.all(pageCalls);
    const validResults = pageResults.filter((r): r is PageResult => r !== null);

    // -------- Merge --------
    const scopeByTrade: Record<string, ScopeItem[]> = {};
    const windows: ScheduleWindow[] = [];
    const doors: ScheduleDoor[] = [];
    const structural: ScheduleStructural[] = [];
    const finishes: ScheduleFinish[] = [];
    const missingInfo: { item: string; whyNeeded: string; suggestedSource: string }[] = [];
    const materialNotes: string[] = [];
    const sheetIndex: { page: number; sheetNumber?: string; title: string; purpose?: string }[] = [];

    let itemCounter = 0;
    for (const pr of validResults) {
      sheetIndex.push({
        page: pr.pageNumber,
        sheetNumber: pr.sheetNumber,
        title: pr.sheetTitle || `Page ${pr.pageNumber}`,
        purpose: pr.sheetPurpose,
      });

      for (const raw of pr.scope || []) {
        const tradeKey = normalizeTradeKey(raw.trade);
        if (!tradeKey) continue;
        // Server-side quality filter
        if (raw.unit && String(raw.unit).toLowerCase() === "lot" && !raw.needsQuote) continue;
        if (raw.quantity !== null && raw.quantity !== undefined && Number(raw.quantity) <= 0 && !raw.needsQuote) continue;
        if (raw.computation && /(estimated from plan grid|based on typical|approximately)/i.test(String(raw.computation))) {
          // Demote to needsQuote rather than drop
          raw.quantity = null;
          raw.unit = null;
          raw.needsQuote = true;
          raw.confidence = "low";
        }
        const item: ScopeItem = {
          id: `s${++itemCounter}`,
          trade: tradeKey,
          description: String(raw.description || "").trim(),
          quantity: raw.quantity === undefined || raw.quantity === null ? null : Number(raw.quantity),
          unit: raw.unit ? String(raw.unit) : null,
          materialSpec: raw.materialSpec,
          sourceSheet: raw.sourceSheet || pr.sheetNumber,
          sourceType: raw.sourceType,
          sourceDetail: raw.sourceDetail,
          computation: raw.computation,
          confidence: (raw.confidence as Confidence) || "low",
          needsQuote: Boolean(raw.needsQuote) || raw.quantity === null,
          notes: raw.notes,
        };
        if (!item.description) continue;
        if (!scopeByTrade[tradeKey]) scopeByTrade[tradeKey] = [];
        scopeByTrade[tradeKey].push(item);
      }

      if (pr.schedules?.windows) windows.push(...pr.schedules.windows);
      if (pr.schedules?.doors) doors.push(...pr.schedules.doors);
      if (pr.schedules?.structural) structural.push(...pr.schedules.structural);
      if (pr.schedules?.finishes) finishes.push(...pr.schedules.finishes);
      if (pr.missing) missingInfo.push(...pr.missing);
      if (pr.notes) materialNotes.push(...pr.notes);
    }

    // -------- 22-trade floor: every trade must have at least one line --------
    for (const t of REQUIRED_TRADES) {
      if (!scopeByTrade[t.key] || scopeByTrade[t.key].length === 0) {
        scopeByTrade[t.key] = [{
          id: `stub_${t.key}`,
          trade: t.key,
          description: `${t.label} — scope TBD, needs sub to quote from plans`,
          quantity: null,
          unit: null,
          confidence: "none",
          needsQuote: true,
          notes: `No specific ${t.label.toLowerCase()} information extracted from drawings. Sub should review plans and quote.`,
        }];
      }
    }

    // -------- Dedup nearly-identical descriptions within a trade --------
    for (const key of Object.keys(scopeByTrade)) {
      const seen = new Map<string, ScopeItem>();
      for (const it of scopeByTrade[key]) {
        const sig = `${it.description.toLowerCase().trim()}|${it.sourceSheet || ""}|${it.quantity || ""}|${it.unit || ""}`;
        if (!seen.has(sig)) seen.set(sig, it);
      }
      scopeByTrade[key] = Array.from(seen.values());
    }

    return NextResponse.json({
      projectSummary: buildProjectSummary(validResults),
      sheetIndex,
      scopeByTrade,
      tradeOrder: TRADE_KEYS,
      tradeLabels: Object.fromEntries(REQUIRED_TRADES.map(t => [t.key, t.label])),
      schedules: { windows, doors, structural, finishes },
      missingInfo: dedupMissing(missingInfo),
      materialNotes: Array.from(new Set(materialNotes)),
      pagesAnalyzed: validResults.length,
      pagesFailed: pages.length - validResults.length,
    });
  } catch (err) {
    console.error("takeoff-full-analyze error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function normalizeTradeKey(raw?: string): string | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim().replace(/[-\s/]+/g, "_");
  if (TRADE_KEYS.includes(s)) return s;
  // Common aliases
  const aliases: Record<string, string> = {
    "site_work": "sitework",
    "site": "sitework",
    "excavation": "sitework",
    "foundation": "concrete",
    "footings": "concrete",
    "slab": "concrete",
    "lvl": "lvl_steel",
    "steel": "lvl_steel",
    "engineered": "lvl_steel",
    "beams": "lvl_steel",
    "structural": "lvl_steel",
    "roof": "roofing",
    "window": "windows",
    "exterior_door": "exterior_doors",
    "doors_exterior": "exterior_doors",
    "trim_exterior": "exterior_trim",
    "trim_interior": "interior_trim",
    "door_interior": "interior_doors",
    "doors_interior": "interior_doors",
    "kitchen_cabinets": "kitchen",
    "cabinets": "kitchen",
    "countertops": "kitchen",
    "appliances": "kitchen",
    "bath": "bathroom",
    "bathrooms": "bathroom",
    "paint": "painting",
    "electric": "electrical",
    "plumb": "plumbing",
    "mech": "hvac",
    "mechanical": "hvac",
    "demo": "demolition",
  };
  return aliases[s] || null;
}

function buildProjectSummary(results: PageResult[]) {
  // Simple aggregation — first sheet's title block info often covers this.
  const cover = results.find(r => /cover/i.test(r.sheetTitle || "") || r.sheetNumber === "A001");
  return {
    sheetsAnalyzed: results.length,
    coverSheet: cover?.sheetNumber || cover?.sheetTitle,
  };
}

function dedupMissing(list: { item: string; whyNeeded: string; suggestedSource: string }[]) {
  const seen = new Set<string>();
  const out: typeof list = [];
  for (const m of list) {
    const key = (m.item || "").toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

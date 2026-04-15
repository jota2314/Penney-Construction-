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
type DerivedFrom =
  | "footprint"
  | "perimeter"
  | "wall_area"
  | "wall_area_minus_openings"
  | "roof_area"
  | "count_windows"
  | "count_doors"
  | "";

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
  derivedFrom?: DerivedFrom;     // when set, client recomputes qty from projectDimensions
}

interface ProjectDim {
  value: number;
  source?: string;
  confidence?: Confidence;
}

interface ProjectDimensions {
  footprintSF?: ProjectDim;
  perimeterLF?: ProjectDim;
  wallHeight?: ProjectDim;
  roofPitchFactor?: ProjectDim;
  exteriorWindowCount?: ProjectDim;
  exteriorDoorCount?: ProjectDim;
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
  projectDimensions?: ProjectDimensions;
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
CRITICAL — FIRST, IDENTIFY WHAT THIS SHEET IS
===================================================================
Read the title block. Look for keywords like "EXISTING", "DEMOLITION",
"REFERENCE", "AS-BUILT", "TYPICAL DETAILS", or "LEGEND".

If this sheet is EXISTING / DEMOLITION / REFERENCE / AS-BUILT:
  → Return an EMPTY scope array. These sheets document existing
    conditions for reference. They are NOT scope.
  → You may still transcribe schedules that live on this sheet ONLY
    IF the schedule items will be kept as-is (rare).
  → Note the sheet in sheetTitle + sheetPurpose so the merger knows.

If this sheet is TYPICAL DETAILS or CONNECTION DETAILS (usually S2.0,
D1.0, etc.):
  → Those show HOW to build joints, NOT what members to use.
  → Do NOT extract rows from "typical beam legend" or "typical joist
    schedule" unless they include specific member callouts tagged
    to actual framing plan locations.
  → When in doubt: skip. The framing plan (S1.0) has the actual members.

If this sheet is PROPOSED / NEW WORK (usually A101, S0.0, S1.0):
  → Extract scope for what's being built here.

===================================================================
FIRST — extract the KEY PROJECT DIMENSIONS if visible on this sheet
===================================================================
A residential addition's entire quantities table derives from ~5 numbers.
If this sheet shows any of the following, fill in the projectDimensions
object. Cite the source (dim strings you read).

  - footprintSF: total footprint of the new addition (sqft)
  - perimeterLF: exterior perimeter of the new addition (linear ft)
  - wallHeight: interior ceiling height (ft, default 9 if not dimensioned)
  - roofPitchFactor: roof pitch multiplier (4:12=1.054, 6:12=1.118, 8:12=1.202, 12:12=1.414)
  - exteriorWindowCount: integer from window schedule / elevations
  - exteriorDoorCount: integer from door schedule / elevations

If you can't read a value on this sheet, LEAVE IT OUT. The orchestrator
merges across pages and picks the highest-confidence value.

===================================================================
SECOND — build scope lines, and TAG each with a derivedFrom formula
===================================================================
You're not a dim-string reader. You're a GC estimator. For every trade
visible on THIS page of NEW/PROPOSED work, output scope items.

For each scope item, set derivedFrom when the quantity rolls up from a
key project dimension (so the UI can recompute if user edits it):

  - "footprint" → qty = footprintSF (units: sqft)
  - "perimeter" → qty = perimeterLF (units: LF)
  - "wall_area" → qty = perimeterLF × wallHeight (units: sqft)
  - "wall_area_minus_openings" → qty = perimeterLF × wallHeight − (windows × 15 + doors × 20) (units: sqft)
  - "roof_area" → qty = footprintSF × roofPitchFactor (units: sqft)
  - "count_windows" → qty = exteriorWindowCount (units: ea)
  - "count_doors" → qty = exteriorDoorCount (units: ea)

Use derivedFrom for items like:
  - Foundation walls, footings (perimeter)
  - Slab, flooring, ceiling drywall, ceiling insulation (footprint)
  - Wall framing SF, wall sheathing, wall insulation, wall drywall (wall_area)
  - Siding SF (wall_area_minus_openings)
  - Roofing SF (roof_area)
  - Gutters LF (perimeter — you can note "minus gable ends" in notes)

For items that don't cleanly derive from the key dims (specific beam
callouts, specific window schedule rows, one-off demo items), leave
derivedFrom empty and set quantity directly as before.

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

NEVER output as SCOPE (these are reference, not work-to-do):
- Rooms or items from EXISTING conditions sheets (e.g., "Bedroom (2nd floor)" from an existing floor plan) — the GC doesn't build existing rooms
- Legend examples (e.g., "3-9½\\" LVL (2-span beam legend example)") — that's a key, not a specified member
- "Typical" details where size/span is "See plan" or blank — those are references
- Rooms labeled "existing" or on a sheet whose title contains "EXISTING" / "DEMO" / "AS-BUILT"
- Generic beam/column schedules from a details sheet (S2.0, D1.0) unless they include a project-specific callout

===================================================================
OUTPUT — valid JSON only, no markdown fences
===================================================================
{
  "pageNumber": ${opts.pageNumber},
  "sheetNumber": "A101" or null,          // read from title block if visible
  "sheetTitle": "First Floor Plan" or null,
  "sheetPurpose": "short sentence",
  "projectDimensions": {
    "footprintSF":        { "value": 946,   "source": "A101: 34'-6\\" × 27'-4\\"",  "confidence": "high" },
    "perimeterLF":        { "value": 123.8, "source": "A101: sum of 4 exterior dims", "confidence": "high" },
    "wallHeight":         { "value": 9,     "source": "default; not dimensioned", "confidence": "low" },
    "roofPitchFactor":    { "value": 1.118, "source": "A101 elevation: 6:12 pitch", "confidence": "medium" },
    "exteriorWindowCount":{ "value": 5,     "source": "A101 elevations", "confidence": "medium" },
    "exteriorDoorCount":  { "value": 1,     "source": "A101: slider rear", "confidence": "high" }
  },
  "scope": [
    { "trade": "concrete", "description": "Foundation perimeter walls", "quantity": 123.8, "unit": "LF",
      "materialSpec": "10\\" poured concrete wall", "sourceSheet": "A101",
      "sourceType": "computed", "derivedFrom": "perimeter",
      "confidence": "high", "needsQuote": false },
    { "trade": "roofing", "description": "Asphalt shingles on addition roof", "quantity": 1058, "unit": "sqft",
      "sourceSheet": "A101", "derivedFrom": "roof_area", "confidence": "medium", "needsQuote": false },
    { "trade": "flooring", "description": "Hardwood flooring to match existing", "quantity": 946, "unit": "sqft",
      "sourceSheet": "A101", "derivedFrom": "footprint", "confidence": "high", "needsQuote": false },
    { "trade": "siding", "description": "Siding to match existing", "quantity": 1016, "unit": "sqft",
      "sourceSheet": "A101", "derivedFrom": "wall_area_minus_openings", "confidence": "medium", "needsQuote": false }
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
            projectDimensions: parsed.projectDimensions,
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
    const mergedProjectDimensions: ProjectDimensions = {};

    // Helper: is this sheet EXISTING/DEMO/REFERENCE? If so, we drop its scope.
    const isReferenceSheet = (title?: string, purpose?: string) => {
      const blob = `${title || ""} ${purpose || ""}`.toLowerCase();
      return /\b(existing|demo|demolition|as[- ]built|reference)\b/.test(blob);
    };

    let itemCounter = 0;
    for (const pr of validResults) {
      sheetIndex.push({
        page: pr.pageNumber,
        sheetNumber: pr.sheetNumber,
        title: pr.sheetTitle || `Page ${pr.pageNumber}`,
        purpose: pr.sheetPurpose,
      });

      const pageIsReference = isReferenceSheet(pr.sheetTitle, pr.sheetPurpose);

      // Merge project dimensions — prefer higher-confidence values
      if (pr.projectDimensions && !pageIsReference) {
        for (const key of ["footprintSF", "perimeterLF", "wallHeight", "roofPitchFactor", "exteriorWindowCount", "exteriorDoorCount"] as const) {
          const incoming = pr.projectDimensions[key];
          if (!incoming || typeof incoming.value !== "number" || !isFinite(incoming.value) || incoming.value <= 0) continue;
          const existing = mergedProjectDimensions[key];
          const rank = (c?: string) => c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0;
          if (!existing || rank(incoming.confidence) > rank(existing.confidence)) {
            mergedProjectDimensions[key] = incoming;
          }
        }
      }

      for (const raw of pr.scope || []) {
        // Drop any scope sourced from an existing/demo/reference sheet.
        if (pageIsReference) continue;
        // Drop scope items that describe existing rooms even if the sheet
        // wasn't clearly marked (belt and suspenders).
        const descLower = String(raw.description || "").toLowerCase();
        if (/\bexisting\b/.test(descLower) && !/demo|remov|replac/.test(descLower)) continue;
        // Drop legend/example lines.
        if (/\b(legend|legend example|typical example|typ\. example|see plan|as shown|tbd)\b/.test(descLower) && !raw.quantity) continue;
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
          derivedFrom: raw.derivedFrom as DerivedFrom | undefined,
        };
        if (!item.description) continue;
        if (!scopeByTrade[tradeKey]) scopeByTrade[tradeKey] = [];
        scopeByTrade[tradeKey].push(item);
      }

      if (pr.schedules?.windows && !pageIsReference) windows.push(...pr.schedules.windows);
      if (pr.schedules?.doors && !pageIsReference) doors.push(...pr.schedules.doors);
      if (pr.schedules?.structural) {
        // Drop structural rows that are "See plan" references — those aren't
        // specified members, they're pointers to another sheet.
        const real = pr.schedules.structural.filter(s => {
          const sizeOrSpan = `${s.size || ""} ${s.span || ""}`.toLowerCase();
          if (/see plan|see framing|tbd|as required/.test(sizeOrSpan) && !/\d/.test(sizeOrSpan)) return false;
          return true;
        });
        structural.push(...real);
      }
      if (pr.schedules?.finishes && !pageIsReference) finishes.push(...pr.schedules.finishes);
      if (pr.missing) missingInfo.push(...pr.missing);
      if (pr.notes) materialNotes.push(...pr.notes);
    }

    // -------- Inject standard derived scope lines for a residential addition --------
    // These auto-compute from the 6 Project Dimensions on the client. Only
    // injected if an equivalent line with the same derivedFrom tag isn't
    // already present from Opus's extraction.
    const STANDARD_DERIVED_LINES: Array<{
      trade: string;
      description: string;
      materialSpec?: string;
      derivedFrom: DerivedFrom;
      unit: string;
      requires?: (keyof ProjectDimensions)[];
    }> = [
      { trade: "concrete", description: "Foundation walls — poured concrete perimeter", derivedFrom: "perimeter", unit: "LF", requires: ["perimeterLF"] },
      { trade: "concrete", description: "Foundation footings — continuous perimeter", derivedFrom: "perimeter", unit: "LF", requires: ["perimeterLF"] },
      { trade: "framing",  description: "Addition framing — floor, walls, roof (labor + material per SF)", derivedFrom: "footprint", unit: "sqft", requires: ["footprintSF"] },
      { trade: "sheathing", description: "Wall sheathing", derivedFrom: "wall_area", unit: "sqft", requires: ["perimeterLF", "wallHeight"] },
      { trade: "sheathing", description: "Roof sheathing", derivedFrom: "roof_area", unit: "sqft", requires: ["footprintSF", "roofPitchFactor"] },
      { trade: "roofing",  description: "Roofing shingles on new addition roof", derivedFrom: "roof_area", unit: "sqft", requires: ["footprintSF", "roofPitchFactor"] },
      { trade: "gutters",  description: "Gutters and downspouts at addition perimeter", derivedFrom: "perimeter", unit: "LF", requires: ["perimeterLF"] },
      { trade: "siding",   description: "Siding on new addition exterior walls", derivedFrom: "wall_area_minus_openings", unit: "sqft", requires: ["perimeterLF", "wallHeight"] },
      { trade: "exterior_trim", description: "Exterior trim (fascia, rake, corner boards)", derivedFrom: "perimeter", unit: "LF", requires: ["perimeterLF"] },
      { trade: "insulation", description: "Exterior wall insulation", derivedFrom: "wall_area", unit: "sqft", requires: ["perimeterLF", "wallHeight"] },
      { trade: "insulation", description: "Ceiling / attic insulation", derivedFrom: "footprint", unit: "sqft", requires: ["footprintSF"] },
      { trade: "drywall",  description: "Wall blueboard / plaster", derivedFrom: "wall_area", unit: "sqft", requires: ["perimeterLF", "wallHeight"] },
      { trade: "drywall",  description: "Ceiling blueboard / plaster", derivedFrom: "footprint", unit: "sqft", requires: ["footprintSF"] },
      { trade: "flooring", description: "Finish flooring across addition", derivedFrom: "footprint", unit: "sqft", requires: ["footprintSF"] },
      { trade: "painting", description: "Interior paint on addition walls & ceilings", derivedFrom: "wall_area", unit: "sqft", requires: ["perimeterLF", "wallHeight"] },
      { trade: "windows",  description: "New exterior windows", derivedFrom: "count_windows", unit: "ea", requires: ["exteriorWindowCount"] },
      { trade: "exterior_doors", description: "New exterior doors", derivedFrom: "count_doors", unit: "ea", requires: ["exteriorDoorCount"] },
    ];

    for (const std of STANDARD_DERIVED_LINES) {
      const already = (scopeByTrade[std.trade] || []).some(i =>
        i.derivedFrom === std.derivedFrom ||
        i.description.toLowerCase().includes(std.description.toLowerCase().split(" ")[0].toLowerCase())
      );
      if (already) continue;
      // Only inject if the required dimensions for derivation are present
      const hasRequired = !std.requires || std.requires.every(k => mergedProjectDimensions[k]?.value && mergedProjectDimensions[k]!.value > 0);
      if (!hasRequired && !std.requires) continue; // no requires means always inject
      if (std.requires && !hasRequired) continue;
      if (!scopeByTrade[std.trade]) scopeByTrade[std.trade] = [];
      scopeByTrade[std.trade].push({
        id: `derived_${std.trade}_${std.derivedFrom}_${++itemCounter}`,
        trade: std.trade,
        description: std.description,
        quantity: null,      // client derives from projectDims
        unit: std.unit,
        derivedFrom: std.derivedFrom,
        confidence: "medium",
        needsQuote: false,
        sourceType: "computed",
        sourceDetail: `Derived from project dimensions (${std.derivedFrom})`,
        materialSpec: std.materialSpec,
      });
    }

    // -------- 23-trade floor: every trade must have at least one line --------
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
    // First pass: exact-description dedupe
    for (const key of Object.keys(scopeByTrade)) {
      const seen = new Map<string, ScopeItem>();
      for (const it of scopeByTrade[key]) {
        const sig = `${it.description.toLowerCase().trim()}|${it.sourceSheet || ""}|${it.quantity || ""}|${it.unit || ""}`;
        if (!seen.has(sig)) seen.set(sig, it);
      }
      scopeByTrade[key] = Array.from(seen.values());
    }

    // Second pass: semantic canonical-key collapse. Items in the same
    // trade that map to the same physical measurement (e.g., "install
    // concrete footings" and "pour concrete footings") get merged so
    // the user measures them once, not multiple times.
    for (const tradeKey of Object.keys(scopeByTrade)) {
      const grouped = new Map<string, ScopeItem[]>();
      const ungrouped: ScopeItem[] = [];
      for (const it of scopeByTrade[tradeKey]) {
        const cKey = canonicalScopeKey(tradeKey, it.description);
        if (!cKey) { ungrouped.push(it); continue; }
        if (!grouped.has(cKey)) grouped.set(cKey, []);
        grouped.get(cKey)!.push(it);
      }
      const collapsed: ScopeItem[] = [];
      for (const [, group] of grouped) {
        if (group.length === 1) { collapsed.push(group[0]); continue; }
        collapsed.push(mergeScopeGroup(group));
      }
      scopeByTrade[tradeKey] = [...collapsed, ...ungrouped];
    }

    return NextResponse.json({
      projectSummary: buildProjectSummary(validResults),
      projectDimensions: mergedProjectDimensions,
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

/**
 * Map a scope item to a canonical physical-measurement key within its trade.
 * Items that share a canonical key describe the same measurement
 * (e.g., "install concrete footings" and "pour concrete footings" both
 * reduce to "concrete:footings") and get merged.
 */
function canonicalScopeKey(tradeKey: string, description: string): string | null {
  const d = String(description || "").toLowerCase();
  if (!d) return null;

  // Order matters — more specific patterns first.
  const rulesByTrade: Record<string, Array<[RegExp, string]>> = {
    concrete: [
      [/(slab on grade|\bsog\b|floor slab|concrete slab)/, "slab"],
      [/(foundation wall|concrete wall|stem wall|cmu wall|poured wall)/, "foundation_walls"],
      [/(footing|footer)/, "footings"],
      [/(pier|column pad|sonotube|caisson)/, "piers"],
      [/(foundation)/, "foundation_general"],
    ],
    framing: [
      [/(floor joist|i[- ]joist|floor fram)/, "floor_joists"],
      [/(ceiling joist|ceiling fram)/, "ceiling_joists"],
      [/(rafter|ridge beam|roof fram|truss)/, "roof_framing"],
      [/(stud|wall fram|wall plate)/, "wall_framing"],
      [/(header|lintel)/, "headers"],
      [/(blocking|bridging)/, "blocking"],
      [/(stair)/, "stairs"],
    ],
    lvl_steel: [
      [/(lvl|laminated veneer)/, "lvl"],
      [/(psl|parallam)/, "psl"],
      [/(steel beam|w[\d]|hss|i[- ]beam)/, "steel_beam"],
      [/(column|post|lally)/, "column"],
      [/(hanger|strap|simpson)/, "hardware"],
    ],
    roofing: [
      [/(shingle)/, "shingles"],
      [/(underlayment|felt|ice.{0,4}water)/, "underlayment"],
      [/(ridge vent)/, "ridge_vent"],
      [/(drip edge)/, "drip_edge"],
      [/(flashing|step flashing)/, "flashing"],
      [/(starter strip)/, "starter"],
      [/(gutter|downspout|leader)/, "gutters"],
    ],
    sheathing: [
      [/(wall sheath)/, "wall_sheathing"],
      [/(roof sheath)/, "roof_sheathing"],
      [/(floor sheath|subfloor)/, "floor_sheathing"],
    ],
    insulation: [
      [/(attic|ceiling|r-?49|r-?38)/, "attic_insulation"],
      [/(wall|r-?21|r-?15|r-?19)/, "wall_insulation"],
      [/(floor|basement|crawl|r-?30)/, "floor_insulation"],
      [/(rim joist|rim band|rim bd)/, "rim_joist"],
      [/(spray foam|closed cell|open cell)/, "spray_foam"],
    ],
    drywall: [
      [/(ceiling)/, "ceilings"],
      [/(wall)/, "walls"],
      [/(board|sheetrock|gwb|gypsum)/, "walls"],
    ],
    siding: [
      [/(siding)/, "siding_field"],
      [/(corner board|frieze|rake)/, "trim"],
      [/(soffit|fascia)/, "soffit_fascia"],
    ],
    flooring: [
      // Flooring typically should NOT collapse — each room is its own
      // measurement. Leave all items ungrouped.
    ],
    painting: [
      [/(interior)/, "interior_paint"],
      [/(exterior)/, "exterior_paint"],
      [/(trim)/, "trim_paint"],
    ],
    windows: [
      [/./, "windows_all"], // windows always collapse to one — schedule tells count
    ],
    exterior_doors: [
      [/./, "exterior_doors_all"],
    ],
    interior_doors: [
      [/./, "interior_doors_all"],
    ],
    gutters: [
      [/./, "gutters_all"],
    ],
    demolition: [
      [/(wall)/, "demo_walls"],
      [/(floor|finish)/, "demo_finishes"],
      [/(roof)/, "demo_roof"],
    ],
    sitework: [
      [/(excavat|dig)/, "excavation"],
      [/(backfill|compact)/, "backfill"],
      [/(grade|drainage)/, "grading"],
    ],
  };

  const rules = rulesByTrade[tradeKey];
  if (!rules) return null;
  for (const [re, key] of rules) {
    if (re.test(d)) return `${tradeKey}:${key}`;
  }
  return null;
}

/**
 * Merge a group of scope items that share a canonical key into a single
 * consolidated line. Keep the highest-quality quantity, merge source
 * citations, pick the best description.
 */
function mergeScopeGroup(items: ScopeItem[]): ScopeItem {
  if (items.length === 1) return items[0];

  // Pick the item with the most complete info as the base
  const base = [...items].sort((a, b) => {
    const aScore = (a.quantity ? 10 : 0) + (a.sourceSheet ? 2 : 0) + (a.materialSpec ? 1 : 0);
    const bScore = (b.quantity ? 10 : 0) + (b.sourceSheet ? 2 : 0) + (b.materialSpec ? 1 : 0);
    return bScore - aScore;
  })[0];

  // Longest description wins (most descriptive)
  const description = items.reduce((best, it) =>
    (it.description || "").length > (best.description || "").length ? it : best
  , base).description;

  // Merged sources: "A101, S1.0, S2.0"
  const sheets = Array.from(new Set(
    items.map(i => i.sourceSheet).filter((s): s is string => Boolean(s))
  )).join(", ");

  // Highest confidence wins: high > medium > low > none
  const confRank = { high: 3, medium: 2, low: 1, none: 0 };
  const confidence = items.reduce((best, it) =>
    (confRank[(it.confidence || "none") as keyof typeof confRank] || 0)
      > (confRank[(best.confidence || "none") as keyof typeof confRank] || 0) ? it : best
  , base).confidence;

  // Material spec: pick the non-empty one
  const materialSpec = items.find(i => i.materialSpec)?.materialSpec || base.materialSpec;

  // Notes: combine unique entries
  const notes = Array.from(new Set(
    items.map(i => i.notes).filter((n): n is string => Boolean(n))
  )).join(" · ") || base.notes;

  return {
    ...base,
    description: description || base.description,
    sourceSheet: sheets || base.sourceSheet,
    confidence: confidence as Confidence,
    materialSpec,
    notes,
    sourceDetail: base.sourceDetail ||
      items.find(i => i.sourceDetail)?.sourceDetail,
  };
}

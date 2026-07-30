import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { getUser } from "@/lib/auth/get-user";
import { canViewDesignStudio } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import {
  type RoomSpec,
  type WallId,
  WALL_IDS,
  WALL_LABELS,
  formatFeetInches,
  findMaterial,
  inToFt,
} from "@/types/design";
import { buildElevation, ELEVATION_MARGIN, type Prim } from "@/lib/design/elevation-draw";
import { buildSelections } from "@/lib/design/selections";
import { computeTakeoff } from "@/lib/design/takeoff";
import { openingSegment, fixtureFootprint, doorSwing } from "@/lib/design/plan";

/**
 * The drawing set as a PDF: plan, four elevations, selections, quantities.
 *
 * Drawn with jsPDF vector primitives rather than rasterising the on-screen SVG,
 * so the sheet stays crisp at any zoom and the file stays small. The elevations
 * come from the same `buildElevation` display list the screen uses, so the PDF
 * cannot quietly drift from what was designed.
 */

export const maxDuration = 60;

const ADDRESS_LINE =
  "5 Barrett Road, Peabody, MA 01960  ·  Tel: 978-621-4387  ·  HIC Reg #198443";

// Letter landscape, points.
const PW = 792;
const PH = 612;
const M = 36;

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canViewDesignStudio(user.profile?.email ?? user.email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const designId = new URL(request.url).searchParams.get("designId");
  if (!designId) {
    return NextResponse.json({ error: "designId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: design } = await supabase
    .from("bathroom_designs")
    .select("name, project_label, spec")
    .eq("id", designId)
    .eq("owner_id", user.id)
    .single();

  if (!design?.spec) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  const spec = design.spec as RoomSpec;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });

  let sheet = 1;
  const sheets =
    2 + WALL_IDS.length; // plan + elevations + selections

  drawPlanSheet(doc, spec, design.name, design.project_label, sheet++, sheets);

  for (const wall of WALL_IDS) {
    doc.addPage();
    drawElevationSheet(doc, spec, wall, design.name, design.project_label, sheet++, sheets);
  }

  doc.addPage();
  drawSelectionsSheet(doc, spec, design.name, design.project_label, sheet++, sheets);

  const bytes = doc.output("arraybuffer");
  const safe = (design.name || "bathroom").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return new NextResponse(bytes as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safe}-drawings.pdf"`,
    },
  });
}

// ── Sheet furniture ──────────────────────────────────────────────────────────

function titleBlock(
  doc: jsPDF,
  title: string,
  designName: string,
  projectLabel: string | null,
  sheet: number,
  total: number,
) {
  doc.setDrawColor(31, 41, 55);
  doc.setLineWidth(1);
  doc.rect(M, M, PW - M * 2, PH - M * 2);

  // Header strip
  doc.setFillColor(31, 41, 55);
  doc.rect(M, M, PW - M * 2, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("PENNEY CONSTRUCTION, INC.", M + 10, M + 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(ADDRESS_LINE, PW - M - 10, M + 17, { align: "right" });

  // Footer strip
  const fy = PH - M - 30;
  doc.setDrawColor(31, 41, 55);
  doc.setLineWidth(0.8);
  doc.line(M, fy, PW - M, fy);
  doc.setTextColor(31, 41, 55);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(title.toUpperCase(), M + 10, fy + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    [designName, projectLabel].filter(Boolean).join("  ·  "),
    PW / 2,
    fy + 18,
    { align: "center" },
  );
  doc.text(`SHEET ${sheet} OF ${total}`, PW - M - 10, fy + 18, { align: "right" });

  // These are concept drawings, and saying so on the sheet is the honest place
  // for it — a drawing without a status gets treated as approved.
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);
  doc.text(
    "CONCEPT — not for construction. Verify all dimensions in the field before ordering.",
    M + 10,
    fy + 27,
  );
  doc.setTextColor(31, 41, 55);
}

/** Usable drawing area inside the frame. */
function contentBox() {
  return { x: M + 14, y: M + 38, w: PW - M * 2 - 28, h: PH - M * 2 - 84 };
}

// ── Plan ─────────────────────────────────────────────────────────────────────

function drawPlanSheet(
  doc: jsPDF,
  spec: RoomSpec,
  name: string,
  label: string | null,
  sheet: number,
  total: number,
) {
  titleBlock(doc, "Floor plan", name, label, sheet, total);
  const box = contentBox();

  const padIn = 26;
  const totalW = spec.room.widthIn + padIn * 2;
  const totalH = spec.room.lengthIn + padIn * 2;
  const scale = Math.min(box.w / totalW, box.h / totalH);

  const X = (xIn: number) => box.x + (box.w - totalW * scale) / 2 + (xIn + padIn) * scale;
  const Y = (zIn: number) => box.y + (box.h - totalH * scale) / 2 + (zIn + padIn) * scale;

  const wallT = 4.5 * scale;

  // Walls as poche
  doc.setFillColor(31, 41, 55);
  doc.rect(X(0) - wallT, Y(0) - wallT, spec.room.widthIn * scale + wallT * 2, wallT, "F");
  doc.rect(X(0) - wallT, Y(spec.room.lengthIn), spec.room.widthIn * scale + wallT * 2, wallT, "F");
  doc.rect(X(0) - wallT, Y(0), wallT, spec.room.lengthIn * scale, "F");
  doc.rect(X(spec.room.widthIn), Y(0), wallT, spec.room.lengthIn * scale, "F");

  // Openings knock the poche out
  for (const w of spec.walls) {
    for (const op of w.openings) {
      const seg = openingSegment(w.id, op, spec.room);
      const horizontal = w.id === "back" || w.id === "front";
      doc.setFillColor(255, 255, 255);
      if (horizontal) {
        doc.rect(
          X(Math.min(seg.x1, seg.x2)),
          Y(seg.z1) - wallT - 0.5,
          op.widthIn * scale,
          wallT * 2 + 1,
          "F",
        );
      } else {
        doc.rect(
          X(seg.x1) - wallT - 0.5,
          Y(Math.min(seg.z1, seg.z2)),
          wallT * 2 + 1,
          op.widthIn * scale,
          "F",
        );
      }

      if (op.type === "door") {
        const s = doorSwing(w.id, op, spec.room, 10);
        doc.setDrawColor(150, 150, 150);
        doc.setLineWidth(0.5);
        for (let i = 0; i < s.arc.length - 1; i++) {
          doc.line(X(s.arc[i].x), Y(s.arc[i].z), X(s.arc[i + 1].x), Y(s.arc[i + 1].z));
        }
        doc.setDrawColor(31, 41, 55);
        doc.setLineWidth(1.2);
        doc.line(X(s.hinge.x), Y(s.hinge.z), X(s.open.x), Y(s.open.z));
      }
      if (op.type === "niche") {
        doc.setDrawColor(180, 83, 9);
        doc.setLineWidth(0.8);
        doc.rect(
          X(Math.min(seg.x1, seg.x2)) - (horizontal ? 0 : wallT),
          Y(Math.min(seg.z1, seg.z2)) - (horizontal ? wallT : 0),
          horizontal ? op.widthIn * scale : wallT * 2,
          horizontal ? wallT * 2 : op.widthIn * scale,
        );
      }
    }
  }

  // Fixtures
  doc.setDrawColor(31, 41, 55);
  for (const f of spec.fixtures) {
    const { spanX, spanZ } = fixtureFootprint(f);
    const x = X(f.x - spanX / 2);
    const y = Y(f.z - spanZ / 2);
    const w = spanX * scale;
    const h = spanZ * scale;

    const isWall = f.type === "knee_wall" || f.type === "partition";
    if (isWall) {
      doc.setFillColor(31, 41, 55);
      doc.rect(x, y, w, h, "F");
    } else {
      doc.setFillColor(248, 250, 252);
      doc.setLineWidth(0.9);
      doc.rect(x, y, w, h, "FD");
      if (w > 34 && h > 16) {
        doc.setFontSize(6.5);
        doc.setTextColor(31, 41, 55);
        doc.text((f.label ?? f.type.replace(/_/g, " ")).toUpperCase(), x + w / 2, y + h / 2 + 2, {
          align: "center",
        });
      }
    }
  }

  // Overall dimensions
  doc.setDrawColor(180, 83, 9);
  doc.setTextColor(180, 83, 9);
  doc.setLineWidth(0.7);
  doc.setFontSize(8);
  const dy = Y(spec.room.lengthIn) + 22;
  doc.line(X(0), dy, X(spec.room.widthIn), dy);
  doc.text(formatFeetInches(spec.room.widthIn), (X(0) + X(spec.room.widthIn)) / 2, dy - 4, {
    align: "center",
  });
  const dx = X(0) - 22;
  doc.line(dx, Y(0), dx, Y(spec.room.lengthIn));
  doc.text(formatFeetInches(spec.room.lengthIn), dx - 4, (Y(0) + Y(spec.room.lengthIn)) / 2, {
    align: "center",
    angle: 90,
  });

  doc.setTextColor(31, 41, 55);
  doc.setFontSize(8);
  doc.text(
    `${formatFeetInches(spec.room.widthIn)} x ${formatFeetInches(spec.room.lengthIn)}  ·  ceiling ${formatFeetInches(spec.room.ceilingHeightIn)}  ·  ${Math.round(inToFt(spec.room.widthIn) * inToFt(spec.room.lengthIn))} SF`,
    box.x,
    box.y - 8,
  );
}

// ── Elevation ────────────────────────────────────────────────────────────────

function drawElevationSheet(
  doc: jsPDF,
  spec: RoomSpec,
  wall: WallId,
  name: string,
  label: string | null,
  sheet: number,
  total: number,
) {
  titleBlock(doc, `${WALL_LABELS[wall]} elevation`, name, label, sheet, total);
  const box = contentBox();

  const drawing = buildElevation(spec, wall);
  const m = ELEVATION_MARGIN;
  const totalW = drawing.runIn + m.left + m.right;
  const totalH = drawing.heightIn + m.top + m.bottom;
  const scale = Math.min(box.w / totalW, box.h / totalH);

  const offX = box.x + (box.w - totalW * scale) / 2;
  const offY = box.y + (box.h - totalH * scale) / 2;
  const X = (x: number) => offX + (x + m.left) * scale;
  const Y = (y: number) => offY + (drawing.heightIn + m.top - y) * scale;

  for (const p of drawing.prims) drawPrim(doc, p, X, Y, scale);

  // Finish callout
  const w = spec.walls.find((x) => x.id === wall);
  const lower = findMaterial(spec, w?.finish.materialId);
  const upper = findMaterial(spec, w?.finish.upperMaterialId);
  doc.setTextColor(31, 41, 55);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Finish: ${lower?.name ?? "not selected"}${upper ? `, ${upper.name} above ${formatFeetInches(w?.finish.splitHeightIn ?? 0)}` : ""}`,
    box.x,
    box.y - 8,
  );

  if (drawing.notes.length) {
    doc.setFontSize(7);
    doc.setTextColor(180, 83, 9);
    drawing.notes.slice(0, 2).forEach((n, i) => {
      doc.text(`• ${n}`, box.x, box.y + box.h + 10 + i * 9);
    });
    doc.setTextColor(31, 41, 55);
  }
}

/** One display-list primitive onto the page. */
function drawPrim(
  doc: jsPDF,
  p: Prim,
  X: (x: number) => number,
  Y: (y: number) => number,
  scale: number,
) {
  switch (p.t) {
    case "rect": {
      const x = X(p.x);
      const y = Y(p.y + p.h);
      const w = Math.max(0, p.w * scale);
      const h = Math.max(0, p.h * scale);
      if (p.fill) {
        const c = hex(p.fill);
        doc.setFillColor(c[0], c[1], c[2]);
      }
      if (p.stroke) {
        const c = hex(p.stroke);
        doc.setDrawColor(c[0], c[1], c[2]);
        doc.setLineWidth(p.lw ?? 1);
      }
      doc.rect(x, y, w, h, p.fill && p.stroke ? "FD" : p.fill ? "F" : "D");
      break;
    }
    case "line": {
      const c = hex(p.stroke);
      doc.setDrawColor(c[0], c[1], c[2]);
      doc.setLineWidth(p.lw ?? 1);
      doc.line(X(p.x1), Y(p.y1), X(p.x2), Y(p.y2));
      break;
    }
    case "circle": {
      if (p.fill) {
        const c = hex(p.fill);
        doc.setFillColor(c[0], c[1], c[2]);
      }
      if (p.stroke) {
        const c = hex(p.stroke);
        doc.setDrawColor(c[0], c[1], c[2]);
        doc.setLineWidth(p.lw ?? 1);
      }
      doc.circle(X(p.cx), Y(p.cy), Math.max(0.8, p.r * scale), p.fill && p.stroke ? "FD" : p.fill ? "F" : "D");
      break;
    }
    case "text": {
      const c = hex(p.color ?? "#1f2937");
      doc.setTextColor(c[0], c[1], c[2]);
      doc.setFont("helvetica", p.bold ? "bold" : "normal");
      doc.setFontSize(p.size);
      doc.text(p.s, X(p.x), Y(p.y), {
        align: p.align === "center" ? "center" : p.align === "right" ? "right" : "left",
      });
      break;
    }
  }
}

function hex(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", ""), 16);
  if (Number.isNaN(n)) return [31, 41, 55];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Selections ───────────────────────────────────────────────────────────────

function drawSelectionsSheet(
  doc: jsPDF,
  spec: RoomSpec,
  name: string,
  label: string | null,
  sheet: number,
  total: number,
) {
  titleBlock(doc, "Selections & quantities", name, label, sheet, total);
  const box = contentBox();
  const { rows, open } = buildSelections(spec);
  const takeoff = computeTakeoff(spec);

  const cols = [
    { key: "location", label: "Location", w: 150 },
    { key: "product", label: "Product", w: 165 },
    { key: "size", label: "Size", w: 55 },
    { key: "pattern", label: "Pattern", w: 70 },
    { key: "grout", label: "Grout", w: 80 },
    { key: "finish", label: "Finish", w: 55 },
    { key: "qty", label: "Order", w: 75 },
  ];

  let y = box.y + 6;
  doc.setFillColor(240, 240, 238);
  doc.rect(box.x, y - 10, box.w, 15, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(31, 41, 55);
  let cx = box.x + 4;
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), cx, y);
    cx += c.w;
  }
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  for (const r of rows) {
    if (y > box.y + box.h - 60) break;

    if (r.missing) {
      doc.setTextColor(180, 83, 9);
    } else {
      doc.setTextColor(31, 41, 55);
    }

    cx = box.x + 4;
    const cells = [
      r.location,
      r.product,
      r.size,
      r.pattern,
      r.grout,
      r.finish,
      r.orderSf ? `${r.orderSf} SF${r.pieces ? ` / ${r.pieces} pc` : ""}` : "",
    ];
    cells.forEach((cell, i) => {
      doc.text(String(cell).slice(0, 42), cx, y);
      cx += cols[i].w;
    });

    doc.setDrawColor(225, 225, 225);
    doc.setLineWidth(0.4);
    doc.line(box.x, y + 3, box.x + box.w, y + 3);
    y += 12;
  }

  // Summary strip
  y += 8;
  doc.setTextColor(31, 41, 55);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(
    `Floor ${takeoff.floorAreaSf} SF   ·   Paint ${takeoff.paintSf} SF   ·   Edge trim ${takeoff.edgeTrimLf} LF   ·   Perimeter ${takeoff.perimeterLf} LF`,
    box.x,
    y,
  );

  if (open.length) {
    y += 14;
    doc.setTextColor(180, 83, 9);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Still to select:", box.x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    y += 10;
    for (const o of open.slice(0, 8)) {
      doc.text(`• ${o}`, box.x + 6, y);
      y += 9;
    }
  }
}

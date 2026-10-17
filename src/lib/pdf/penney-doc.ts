import "server-only";
import { GState, jsPDF } from "jspdf";
import autoTable, { type CellInput, type RowInput, type Styles } from "jspdf-autotable";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";

/**
 * The Penney PDF house style as shared pieces: header, title bar, section
 * bars, key/value block, wrapped text with bullets, numbered terms, the
 * signature lines, the e-signature record box and the footer.
 *
 * COPIED from src/app/api/generate-contract/route.ts (the constants, header,
 * section header, terms renderer, signatures and audit box). That route is a
 * live client flow and is deliberately not refactored onto this module in
 * Round 1 (plan §5.4); the client contract moves here in Round 3. Six routes
 * already carry their own copy, so new documents start here instead.
 *
 * Two things this adds:
 *  - Repeatable output. Given a `fileKey` and `createdAt`, the same content
 *    renders to the same bytes (jsPDF otherwise stamps the clock and a random
 *    file id), so a SHA-256 taken when a document is sent can be checked
 *    again when it is signed.
 *  - A diagonal watermark ("DRAFT - NOT FOR SIGNATURE", "VOID") on every page.
 */

export type RGB = [number, number, number];

// Penney brand colors (same values as generate-contract / generate-proposal-pdf)
export const PDF_CHARCOAL: RGB = [61, 61, 61];
export const PDF_ORANGE: RGB = [212, 114, 42];
export const PDF_PEACH: RGB = [253, 241, 234];
export const PDF_WHITE: RGB = [255, 255, 255];
export const PDF_BLACK: RGB = [0, 0, 0];
const MUTED: RGB = [90, 90, 90];

export const PENNEY_HIC_LINE = "Licensed & Insured  ·  MA Home Improvement Contractor";
export const PENNEY_ADDRESS_LINE = "5 Barrett Road, Peabody, MA 01960  ·  Tel: 978-621-4387  ·  HIC Reg #198443";
export const PENNEY_CSL_LINE = "CS-099765 (Unrestricted)  ·  Expires 09/26/2027";
export const PENNEY_FOOTER_LINE = "Penney Construction, Inc.  ·  5 Barrett Road, Peabody, MA 01960  ·  978-621-4387  ·  HIC #198443";

/**
 * Same Latin-1 sanitation as generate-contract: jsPDF's Helvetica mis-measures
 * glyphs outside WinAnsi and autoTable stretches the text.
 */
export function sanitizeForPdf(input: unknown): string {
  if (input == null) return "";
  let s = String(input)
    .replace(/[′]/g, "'")
    .replace(/[″]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[×]/g, "x")
    .replace(/[·•]/g, "-")
    .replace(/[ ]/g, " ")
    .replace(/[…]/g, "...")
    .replace(/[∼≈]/g, "~")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[→]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[©]/g, "(c)")
    .replace(/[®]/g, "(R)")
    .replace(/[™]/g, "(TM)");
  s = s.replace(/[^\x00-\xFF]/g, "?");
  return s;
}

/** "$1,234.56" / "-$300.00": money on a document always prints its cents. */
export function pdfMoney(v: number | null | undefined, empty = "-"): string {
  if (v == null || !Number.isFinite(v)) return empty;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "33834" -> "Thirty-Three Thousand Eight Hundred Thirty-Four" (whole dollars). */
export function dollarsInWords(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const under1000 = (x: number): string => {
    const parts: string[] = [];
    if (x >= 100) {
      parts.push(`${ones[Math.floor(x / 100)]} Hundred`);
      x %= 100;
    }
    if (x >= 20) {
      parts.push(x % 10 ? `${tens[Math.floor(x / 10)]}-${ones[x % 10]}` : tens[Math.floor(x / 10)]);
    } else if (x > 0) {
      parts.push(ones[x]);
    }
    return parts.join(" ");
  };
  const whole = Math.floor(Math.abs(n));
  if (whole === 0) return "Zero";
  const chunks: string[] = [];
  const millions = Math.floor(whole / 1_000_000);
  const thousands = Math.floor((whole % 1_000_000) / 1000);
  const rest = whole % 1000;
  if (millions) chunks.push(`${under1000(millions)} Million`);
  if (thousands) chunks.push(`${under1000(thousands)} Thousand`);
  if (rest) chunks.push(under1000(rest));
  return chunks.join(" ");
}

/** "(Six Thousand and 00/100 Dollars)". */
export function amountInWords(v: number): string {
  const cents = Math.round(Math.abs(v) * 100) % 100;
  return `(${v < 0 ? "Minus " : ""}${dollarsInWords(v)} and ${String(cents).padStart(2, "0")}/100 Dollars)`;
}

/** Lowercase hex SHA-256 of a rendered document. */
export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** ET date and time for a signature line: "October 17, 2026 at 3:12:08 PM EDT". */
export function etDateTimeLong(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "long", timeZone: "America/New_York" });
}

/** "Oct 17, 2026" in ET (a calendar day string prints as that day). */
export function etDateShort(value: string | null | undefined): string {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export interface PenneyDocOptions {
  /** A stable id for this document (an agreement id). Same key + same content = same bytes. */
  fileKey?: string;
  /** The creation date written into the PDF. Fix it to keep the output repeatable. */
  createdAt?: string | Date | null;
  /** Diagonal text across every page, e.g. "DRAFT - NOT FOR SIGNATURE". */
  watermark?: string | null;
  /** PDF title metadata. */
  title?: string;
}

export interface SignatureColumn {
  /** The typed name, printed in script above the line; null leaves the line blank. */
  signature?: string | null;
  /** Under the line: "Penney Construction, Inc. - Ryan Penney, Owner". */
  caption: string;
  /** The date under the line, right side. */
  date?: string | null;
}

/**
 * A letter-size Penney document. Methods draw at the running `y` and move it
 * down, adding pages (with the header) as needed. Call `finish()` once.
 */
export class PenneyDoc {
  readonly doc: jsPDF;
  readonly pw: number;
  readonly ph: number;
  readonly margin = 18;
  readonly contentW: number;
  y = 36;
  private readonly opts: PenneyDocOptions;
  private logoBase64: string | null = null;

  constructor(opts: PenneyDocOptions = {}) {
    this.opts = opts;
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    this.pw = this.doc.internal.pageSize.getWidth();
    this.ph = this.doc.internal.pageSize.getHeight();
    this.contentW = this.pw - this.margin * 2;
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.jpg");
      if (fs.existsSync(logoPath)) this.logoBase64 = fs.readFileSync(logoPath).toString("base64");
    } catch {
      /* the header simply has no logo */
    }
    this.pageHeader();
  }

  /** Logo left, company block right, orange rule. */
  pageHeader() {
    const { doc, margin, pw, contentW } = this;
    if (this.logoBase64) {
      try {
        doc.addImage(`data:image/jpeg;base64,${this.logoBase64}`, "JPEG", margin, 10, 28, 18);
      } catch {
        /* */
      }
    }
    doc.setTextColor(...PDF_CHARCOAL);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("PENNEY CONSTRUCTION, INC.", pw - margin, 14, { align: "right" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(sanitizeForPdf(PENNEY_HIC_LINE), pw - margin, 19, { align: "right" });
    doc.text(sanitizeForPdf(PENNEY_ADDRESS_LINE), pw - margin, 23, { align: "right" });
    doc.setFillColor(...PDF_ORANGE);
    doc.rect(margin, 30, contentW, 1, "F");
  }

  newPage() {
    this.doc.addPage();
    this.pageHeader();
    this.y = 36;
  }

  /** Start a new page when `height` mm won't fit above the footer. */
  ensure(height: number) {
    if (this.y + height > this.ph - 20) this.newPage();
  }

  /** The charcoal title bar: "WORK ORDER WO-046-01". */
  titleBar(text: string) {
    const { doc, margin, contentW, pw } = this;
    doc.setFillColor(...PDF_CHARCOAL);
    doc.rect(margin, this.y, contentW, 12, "F");
    doc.setTextColor(...PDF_WHITE);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(sanitizeForPdf(text), pw / 2, this.y + 8, { align: "center" });
    doc.setFillColor(...PDF_ORANGE);
    doc.rect(margin, this.y + 12, contentW, 1.5, "F");
    this.y += 18;
  }

  sectionHeader(label: string) {
    const { doc, margin, contentW } = this;
    if (this.y > this.ph - 40) this.newPage();
    doc.setFillColor(...PDF_CHARCOAL);
    doc.rect(margin, this.y, contentW, 8, "F");
    doc.setTextColor(...PDF_WHITE);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(sanitizeForPdf(label), margin + 3, this.y + 5.5);
    doc.setFillColor(...PDF_ORANGE);
    doc.rect(margin, this.y + 8, contentW, 1.5, "F");
    this.y += 12;
  }

  /** Two-column label/value block (the contract's PARTIES table). */
  keyValues(rows: [string, string | null | undefined][], labelWidth = 40) {
    const body = rows
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => [sanitizeForPdf(k), sanitizeForPdf(v)]);
    if (body.length === 0) return;
    autoTable(this.doc, {
      startY: this.y,
      head: [],
      body,
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: labelWidth, textColor: PDF_CHARCOAL },
        1: { textColor: PDF_BLACK },
      },
      margin: { left: this.margin, right: this.margin },
    });
    this.y = this.lastTableY() + 4;
  }

  /** The orange total row: "WORK ORDER PRICE ........ $6,000.00". */
  amountBar(label: string, amount: string) {
    autoTable(this.doc, {
      startY: this.y,
      head: [],
      body: [[sanitizeForPdf(label), sanitizeForPdf(amount)]],
      theme: "grid",
      styles: { fontSize: 10, cellPadding: 3.5, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: this.contentW - 45 },
        1: { halign: "right", cellWidth: 45 },
      },
      margin: { left: this.margin, right: this.margin },
      didParseCell: (data) => {
        data.cell.styles.fillColor = PDF_ORANGE;
        data.cell.styles.textColor = PDF_WHITE;
      },
    });
    this.y = this.lastTableY() + 3;
  }

  /** A grid table in the house colors. */
  table(head: string[], body: CellInput[][], columnStyles?: Record<number, Partial<Styles>>) {
    autoTable(this.doc, {
      startY: this.y,
      head: [head.map((h) => sanitizeForPdf(h))] as RowInput[],
      body: body.map((row) => row.map((c) => (typeof c === "string" ? sanitizeForPdf(c) : c))) as RowInput[],
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: PDF_CHARCOAL, textColor: PDF_WHITE, fontStyle: "bold", fontSize: 8 },
      bodyStyles: { textColor: PDF_BLACK },
      alternateRowStyles: { fillColor: PDF_PEACH },
      columnStyles: columnStyles as Record<string, Partial<Styles>> | undefined,
      margin: { left: this.margin, right: this.margin },
    });
    this.y = this.lastTableY() + 4;
  }

  /**
   * Wrapped text. A blank line or "\n" starts a new paragraph; a line that
   * starts with "- " is a bullet with a hanging indent.
   */
  text(
    text: string | null | undefined,
    opts: { size?: number; bold?: boolean; italic?: boolean; color?: RGB; indent?: number; gap?: number } = {},
  ) {
    const clean = sanitizeForPdf(text ?? "").replace(/\r\n?/g, "\n");
    if (!clean.trim()) return;
    const { doc, margin, contentW } = this;
    const size = opts.size ?? 7.5;
    const lineH = size * 0.53;
    const indent = opts.indent ?? 3;
    doc.setFontSize(size);
    doc.setFont("helvetica", opts.bold ? "bold" : opts.italic ? "italic" : "normal");
    doc.setTextColor(...(opts.color ?? PDF_BLACK));
    for (const raw of clean.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        this.y += lineH * 0.6;
        continue;
      }
      const bullet = /^\s*-\s+/.test(line);
      const body = bullet ? line.replace(/^\s*-\s+/, "") : line;
      const x = margin + indent + (bullet ? 4 : 0);
      const width = contentW - indent - (bullet ? 4 : 0) - 3;
      const lines = doc.splitTextToSize(body, width) as string[];
      for (let i = 0; i < lines.length; i++) {
        if (this.y + lineH > this.ph - 20) {
          this.newPage();
          doc.setFontSize(size);
          doc.setFont("helvetica", opts.bold ? "bold" : opts.italic ? "italic" : "normal");
          doc.setTextColor(...(opts.color ?? PDF_BLACK));
        }
        if (bullet && i === 0) doc.text("-", margin + indent + 1, this.y + lineH);
        doc.text(lines[i], x, this.y + lineH);
        this.y += lineH;
      }
      this.y += opts.gap ?? 1.2;
    }
  }

  /** Numbered terms: a bold "1. Title" line, then the body as paragraphs. */
  numberedTerms(terms: { title: string; body: string }[], start = 1) {
    terms.forEach((t, i) => {
      this.ensure(14);
      this.text(`${start + i}. ${t.title}`, { bold: true, size: 8, gap: 0.6 });
      this.text(t.body, { indent: 6 });
      this.y += 1.5;
    });
  }

  /** Two signature lines side by side, the typed names in script above them. */
  signatures(left: SignatureColumn, right: SignatureColumn) {
    const { doc, margin, contentW } = this;
    this.ensure(30);
    this.y += 14;
    const colW = (contentW - 20) / 2;
    const xs = [margin + 3, margin + 17 + colW];
    [left, right].forEach((col, i) => {
      if (col.signature) {
        doc.setFont("times", "italic");
        doc.setFontSize(13);
        doc.setTextColor(...PDF_BLACK);
        doc.text(sanitizeForPdf(col.signature), xs[i], this.y - 2);
      }
    });
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(120, 120, 120);
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    [left, right].forEach((col, i) => {
      doc.line(xs[i], this.y, xs[i] + colW, this.y);
      const caption = doc.splitTextToSize(sanitizeForPdf(col.caption), colW - 22) as string[];
      doc.text(caption, xs[i], this.y + 4);
      doc.text(sanitizeForPdf(col.date || "Date"), xs[i] + colW - 20, this.y + 4);
    });
    this.y += 12;
  }

  /**
   * The grey record box under the signatures (ESIGN / M.G.L. c.110G: the
   * record behind an electronic signature goes on the document itself).
   */
  recordBox(title: string, lines: string[], note?: string | null) {
    const { doc, margin, contentW } = this;
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    const wrapped = lines.flatMap((l) => doc.splitTextToSize(sanitizeForPdf(l), contentW - 6) as string[]);
    const noteLines = note ? (doc.splitTextToSize(sanitizeForPdf(note), contentW - 6) as string[]) : [];
    const height = 8 + wrapped.length * 3.2 + (noteLines.length ? 2 + noteLines.length * 3 : 0) + 2;
    this.ensure(height + 4);
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(248, 248, 248);
    doc.rect(margin, this.y, contentW, height, "FD");
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "bold");
    doc.text(sanitizeForPdf(title), margin + 3, this.y + 4.5);
    doc.setFont("helvetica", "normal");
    let ly = this.y + 8.5;
    for (const l of wrapped) {
      doc.text(l, margin + 3, ly);
      ly += 3.2;
    }
    if (noteLines.length) {
      ly += 1.5;
      doc.setFont("helvetica", "italic");
      for (const l of noteLines) {
        doc.text(l, margin + 3, ly);
        ly += 3;
      }
      doc.setFont("helvetica", "normal");
    }
    this.y += height + 4;
  }

  /** Footer and watermark on every page, then the bytes. */
  finish(): Buffer {
    const { doc, margin, contentW, pw, ph } = this;
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFillColor(...PDF_ORANGE);
      doc.rect(margin, ph - 10, contentW, 0.5, "F");
      doc.setFontSize(6);
      doc.setTextColor(130, 130, 130);
      doc.setFont("helvetica", "normal");
      doc.text(sanitizeForPdf(PENNEY_FOOTER_LINE), pw / 2, ph - 6, { align: "center" });
      doc.text(`Page ${i} of ${total}`, pw - margin, ph - 6, { align: "right" });
      if (this.opts.watermark) this.drawWatermark(this.opts.watermark);
    }
    if (this.opts.title) doc.setDocumentProperties({ title: sanitizeForPdf(this.opts.title), creator: "Penney Construction, Inc." });
    doc.setCreationDate(this.opts.createdAt ? new Date(this.opts.createdAt) : new Date());
    if (this.opts.fileKey) doc.setFileId(createHash("md5").update(this.opts.fileKey).digest("hex").toUpperCase());
    return Buffer.from(doc.output("arraybuffer"));
  }

  private drawWatermark(text: string) {
    const { doc, pw, ph } = this;
    const label = sanitizeForPdf(text);
    doc.saveGraphicsState();
    doc.setGState(new GState({ opacity: 0.13 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(label.length > 12 ? 40 : 72);
    doc.setTextColor(...PDF_ORANGE);
    const w = doc.getTextWidth(label);
    const a = Math.PI / 4;
    // Centered on the page, running up to the right at 45 degrees.
    doc.text(label, pw / 2 - (w / 2) * Math.cos(a), ph / 2 + (w / 2) * Math.sin(a), { angle: 45 });
    doc.restoreGraphicsState();
  }

  private lastTableY(): number {
    return (this.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  }
}

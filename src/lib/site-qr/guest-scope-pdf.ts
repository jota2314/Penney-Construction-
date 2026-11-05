import "server-only";
import { PenneyDoc, PDF_CHARCOAL, PDF_ORANGE, PDF_WHITE, sanitizeForPdf } from "@/lib/pdf/penney-doc";
import type { GuestJobScope, GuestScopeSection } from "@/lib/site-qr/guest-scope";
import { priceFreeScopeText } from "@/lib/site-qr/scope-text";

export class GuestScopePdfError extends Error {
  constructor(message: string, public readonly status: 400 | 409) { super(message); }
}

/** Trade selection narrows a field reference; it never changes job access. */
export function selectGuestScopeSections(scope: GuestJobScope, trade: string | null = null): GuestScopeSection[] {
  if (trade === null) return scope.sections;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trade) || trade.length > 120 || !scope.sections.some((section) => section.id === trade)) {
    throw new GuestScopePdfError("That trade isn't available for this job.", 400);
  }
  return scope.sections.filter((section) => section.id === trade || section.id === "general");
}

const clean = (value: unknown) => sanitizeForPdf(priceFreeScopeText(value));
const cleanInline = (value: unknown) => clean(value).replace(/\s+/g, " ").trim();

/** Wrapped section bars keep long trade names inside the printable area. */
function sectionBar(pdf: PenneyDoc, label: string, firstItemHeight: number) {
  const { doc, margin, contentW } = pdf;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(label, contentW - 8) as string[];
  const height = Math.max(10, lines.length * 4.7 + 5);
  pdf.ensure(height + firstItemHeight);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setFillColor(...PDF_CHARCOAL);
  doc.rect(margin, pdf.y, contentW, height, "F");
  doc.setTextColor(...PDF_WHITE);
  doc.text(lines, margin + 4, pdf.y + 6, { lineHeightFactor: 1.33 });
  doc.setFillColor(...PDF_ORANGE);
  doc.rect(margin, pdf.y + height, contentW, 1.2, "F");
  pdf.y += height + 5;
}

function titleHeight(pdf: PenneyDoc, title: string) {
  pdf.doc.setFont("helvetica", "bold");
  pdf.doc.setFontSize(11);
  return (pdf.doc.splitTextToSize(title, pdf.contentW - 6) as string[]).length * 5.83 + 8;
}

export function guestScopePdfFilename(scope: GuestJobScope, trade: string | null = null): string {
  const job = cleanInline(scope.project.number || scope.project.name).normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 65) || "Job";
  const suffix = trade && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trade) ? `-${trade.slice(0, 120)}` : "";
  return `${job}-Scope-of-Work${suffix}.pdf`;
}

/** A fresh, read-only field scope. No proposal/contract renderer or price fields. */
export function buildGuestScopePdf(scope: GuestJobScope, trade: string | null = null): Buffer {
  const selected = selectGuestScopeSections(scope, trade);
  if (!scope.source || selected.length === 0) {
    throw new GuestScopePdfError("The approved scope is not available yet. Please contact the Penney office.", 409);
  }
  // Keep only explicitly allowed scope fields, even if callers supply a larger
  // object. The same sanitizer runs again so PDFs cannot bypass the UI boundary.
  const sections = selected.map((section) => ({
    label: cleanInline(section.label) || "General",
    items: section.items.map((item) => ({ title: cleanInline(item.title), description: clean(item.description) }))
      .filter((item) => item.title || item.description),
  })).filter((section) => section.items.length > 0);
  if (!sections.length) throw new GuestScopePdfError("The approved scope is not available yet. Please contact the Penney office.", 409);

  const projectName = cleanInline(scope.project.name) || "Job scope";
  const pdf = new PenneyDoc({ title: `${projectName} - Scope of Work` });
  pdf.titleBar("SCOPE OF WORK");
  pdf.text(projectName, { size: 16, bold: true, indent: 0, gap: 2 });
  const jobDetails = [cleanInline(scope.project.number), cleanInline(scope.project.town)].filter(Boolean).join(" - ");
  if (jobDetails) pdf.text(jobDetails, { size: 10, indent: 0, gap: 2 });

  const selectedLabel = trade ? cleanInline(scope.sections.find((section) => section.id === trade)?.label) : "All trades";
  const filterLabel = trade && trade !== "general" && selected.some((section) => section.id === "general")
    ? `${selectedLabel} and general coordination` : selectedLabel;
  pdf.text(filterLabel || "Selected trade", { size: 10, bold: true, indent: 0 });
  const sourceLabel = cleanInline(scope.source.label) || "Current approved job scope";
  const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(scope.source.date ?? "") ? scope.source.date : null;
  pdf.text([sourceLabel, sourceDate].filter(Boolean).join(" - "), { size: 9, indent: 0, color: [90, 90, 90] });
  pdf.y += 5;

  for (const section of sections) {
    const first = section.items[0];
    sectionBar(pdf, section.label, titleHeight(pdf, first.title || "Work details"));
    for (const [index, item] of section.items.entries()) {
      const title = item.title || "Work details";
      pdf.ensure(titleHeight(pdf, title));
      pdf.text(title, { size: 11, bold: true, indent: 0, gap: 1.4 });
      if (item.description && item.description !== item.title) {
        pdf.text(item.description, { size: 10.5, indent: 2, gap: 1.5 });
      }
      if (index < section.items.length - 1) {
        pdf.y += 3;
        pdf.ensure(8);
        pdf.doc.setDrawColor(226, 226, 226);
        pdf.doc.line(pdf.margin, pdf.y, pdf.pw - pdf.margin, pdf.y);
        pdf.y += 4;
      }
    }
    pdf.y += 5;
  }
  return pdf.finish();
}

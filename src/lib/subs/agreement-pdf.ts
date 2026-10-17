import "server-only";
import {
  PENNEY_CSL_LINE,
  PenneyDoc,
  amountInWords,
  etDateShort,
  etDateTimeLong,
  pdfMoney,
} from "@/lib/pdf/penney-doc";
import { etDate } from "@/lib/sub-portal/et-day";
import { AGREEMENT_KIND_LABEL, PRICE_BASIS_LABEL, agreementAmount, priceLines } from "@/lib/subs/agreement-format";
import { AGREEMENT_WATERMARK_DRAFT, templateHoldsFor, type AgreementBundle } from "@/lib/subs/agreements";

/**
 * The PDF of a master agreement, work order or sub change order.
 *
 * Two renders matter:
 *  - The SENT copy (includeSubSignature false): what Penney signs and the sub
 *    reads. Its bytes are repeatable (fixed file key and creation date, and
 *    nothing that changes when he opens it), and it is stored at
 *    sub-documents/agreements/{id}/sent.pdf with its SHA-256 in pdf_sha256.
 *  - The EXECUTED copy (includeSubSignature true): the same document plus his
 *    signature and the e-signature record, which prints the SHA-256 of the
 *    sent copy he reviewed. Stored at agreements/{id}/signed.pdf.
 */

export interface RenderAgreementOptions {
  /** Print the sub's signature and the e-signature record (the executed copy). */
  includeSubSignature: boolean;
  /**
   * Diagonal text on every page. Default: "DRAFT - NOT FOR SIGNATURE" while
   * the template isn't approved for this sub (a sent or signed agreement may
   * keep one retired since) or the agreement is still a draft; "VOID" / "REPLACED" once voided or superseded; none otherwise.
   */
  watermark?: string | null;
}

/** The watermark rule above, on its own so the routes can reuse it. */
export function defaultAgreementWatermark(b: AgreementBundle): string | null {
  const a = b.agreement;
  if (a.status === "void") return "VOID";
  if (a.status === "superseded") return "REPLACED";
  if (!templateHoldsFor(b)) return AGREEMENT_WATERMARK_DRAFT;
  if (a.status === "draft" && !a.signed_on_paper) return AGREEMENT_WATERMARK_DRAFT;
  if (b.template.test_only) return "TEST ONLY";
  return null;
}

function joinAddress(parts: (string | null | undefined)[]): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(", ");
}

function phoneEnding(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `phone ending ${digits.slice(-4)}` : null;
}

export function renderAgreementPdf(b: AgreementBundle, opts: RenderAgreementOptions): Buffer {
  const a = b.agreement;
  const t = b.template;
  const includeSub = opts.includeSubSignature && !!a.sub_signed_at && !a.signed_on_paper;
  const watermark = opts.watermark !== undefined ? opts.watermark : defaultAgreementWatermark(b);
  const kindLabel = AGREEMENT_KIND_LABEL[a.kind];

  const pdf = new PenneyDoc({
    fileKey: `${a.id}:${includeSub ? "executed" : "sent"}`,
    // Fixed dates keep the bytes repeatable: the sent copy is dated when
    // Penney signed it, the executed copy when the sub did.
    createdAt: includeSub ? a.sub_signed_at : (a.penney_signed_at ?? a.created_at),
    watermark,
    title: `${kindLabel} ${a.number}`,
  });

  pdf.titleBar(`${kindLabel.toUpperCase()} ${a.number}`);

  // ── Parties ──
  pdf.sectionHeader("PARTIES");
  const sub = b.sub;
  const subName = sub.legal_name?.trim() && sub.legal_name.trim() !== sub.company_name
    ? `${sub.legal_name.trim()} (${sub.company_name})`
    : sub.company_name;
  const year = (etDate(a.created_at) ?? "").slice(0, 4);
  pdf.keyValues([
    ["Contractor:", "Penney Construction, Inc."],
    ["Contractor address:", "5 Barrett Road, Peabody, MA 01960  -  Tel: 978-621-4387"],
    ["MA HIC Reg #:", "198443"],
    ["MA CSL #:", PENNEY_CSL_LINE],
    ["Subcontractor:", subName],
    ["Contact:", sub.contact_name],
    ["Subcontractor address:", joinAddress([sub.address, sub.city, [sub.state, sub.zip].filter(Boolean).join(" ")])],
    ["Phone:", sub.phone],
    ["Email:", sub.email],
    ["License #:", sub.license_number],
    ["Agreement no.:", a.number],
    ["Issued:", a.penney_signed_at ? etDateShort(a.penney_signed_at) : "Draft, not issued"],
    ...(a.kind === "master" ? ([["Covers:", `Work orders issued in ${year}`]] as [string, string][]) : []),
    ...(b.project
      ? ([
          ["Project:", b.project.name],
          ["Project address:", joinAddress([b.project.address, b.project.city, [b.project.state, b.project.zip].filter(Boolean).join(" ")])],
          ["Job no.:", b.project.project_number],
        ] as [string, string | null][])
      : []),
    ...(a.kind === "work_order"
      ? ([["Under master agreement:", b.master?.number ?? `Penney's master subcontract agreement for ${year}`]] as [string, string][])
      : []),
    ...(a.kind === "change_order" ? ([["Changes work order:", b.parent?.number ?? "-"]] as [string, string][]) : []),
  ]);

  const money = (n: number | null) => pdfMoney(n);

  // ── Work order / change order body ──
  if (a.kind === "work_order") {
    pdf.sectionHeader("SCOPE OF WORK");
    pdf.text(a.scope_text || "-");
    pdf.y += 2;

    pdf.sectionHeader("EXCLUSIONS");
    pdf.text(a.exclusions_text || "Anything not written in the scope above.");
    pdf.y += 2;

    pdf.sectionHeader("PRICE");
    const amount = agreementAmount(a);
    pdf.amountBar(
      a.price_basis === "time_and_material" ? "NOT TO EXCEED" : a.price_basis === "unit" ? "ESTIMATED TOTAL" : "WORK ORDER PRICE",
      money(amount),
    );
    if (amount != null) pdf.text(amountInWords(amount), { size: 7, color: [100, 100, 100] });
    if (a.price_basis) pdf.text(`Price basis: ${PRICE_BASIS_LABEL[a.price_basis]}`, { bold: true });
    pdf.text(priceLines(a, money).join("\n"));
    pdf.y += 2;

    pdf.sectionHeader("PAYMENT SCHEDULE");
    if (a.draws.length) {
      pdf.table(
        ["Payment", "When", "Amount"],
        a.draws.map((d) => [
          d.label || "-",
          d.when || "-",
          d.amount != null ? money(d.amount) : d.percent != null ? `${d.percent}%` : "-",
        ]),
        { 0: { cellWidth: 55, fontStyle: "bold" }, 2: { halign: "right", cellWidth: 35, fontStyle: "bold" } },
      );
    } else {
      pdf.text("One payment when the scope is complete.");
    }

    pdf.sectionHeader("DATES");
    pdf.text(
      a.start_date
        ? `Start: ${etDateShort(a.start_date)}${a.end_date ? `     Finish: ${etDateShort(a.end_date)}` : ""}`
        : "Dates are set and confirmed in the Penney sub portal.",
    );
    pdf.y += 2;
  }

  if (a.kind === "change_order") {
    pdf.sectionHeader("WHAT CHANGES");
    pdf.text(a.scope_text || "-");
    if (a.exclusions_text) {
      pdf.y += 1;
      pdf.text(`Not included: ${a.exclusions_text}`);
    }
    pdf.y += 2;

    pdf.sectionHeader("PRICE CHANGE");
    const change = agreementAmount(a);
    pdf.amountBar(change != null && change < 0 ? "CREDIT TO PENNEY" : "ADDED TO THE WORK ORDER", money(change));
    if (a.price_basis === "time_and_material") pdf.text(priceLines(a, money).join("\n"));
    const wo = b.changeTotals?.workOrder ?? null;
    const others = b.changeTotals?.otherSignedChanges ?? 0;
    if (wo != null && change != null) {
      pdf.table(
        ["", "Amount"],
        [
          [`Work order ${b.parent?.number ?? ""} price`, money(wo)],
          ["Earlier signed sub change orders", money(others)],
          ["This sub change order", money(change)],
          ["Revised work order total", money(Math.round((wo + others + change) * 100) / 100)],
        ],
        { 1: { halign: "right", cellWidth: 40, fontStyle: "bold" } },
      );
    }
  }

  // ── Owner / association requirements (work orders) ──
  if (a.kind !== "master" && a.additional_terms.length) {
    pdf.sectionHeader("OWNER AND ASSOCIATION REQUIREMENTS");
    pdf.text("These come from Penney's contract with the Owner or the association's rules. They apply only to Subcontractor's own part of the work and are subject to the Indemnity section of the Master Subcontract Agreement.", {
      italic: true,
      size: 7,
    });
    pdf.numberedTerms(a.additional_terms);
  }

  // ── Terms from the template ──
  pdf.sectionHeader(a.kind === "master" ? "TERMS" : a.kind === "work_order" ? "WORK ORDER TERMS" : "SUB CHANGE ORDER TERMS");
  pdf.text(
    `${t.title}, version ${t.version}. ${t.status === "approved" && t.provenance ? t.provenance : "Draft text, not yet approved by Penney."}`,
    { size: 6.5, color: [110, 110, 110] },
  );
  if (t.sections.length) pdf.numberedTerms(t.sections);

  // ── Acceptance and signatures ──
  pdf.ensure(60);
  pdf.sectionHeader("ACCEPTANCE AND SIGNATURES");
  pdf.text(t.acceptance_text);
  pdf.y += 1;
  pdf.text("Electronic signature consent", { bold: true, size: 7 });
  pdf.text(t.esign_consent_text, { size: 7 });

  pdf.signatures(
    {
      signature: includeSub ? a.sub_signed_name : null,
      caption: `Subcontractor - ${sub.company_name}${includeSub && a.sub_signed_name ? ` - ${a.sub_signed_name}` : ""}`,
      date: includeSub ? etDateShort(a.sub_signed_at) : null,
    },
    {
      signature: a.penney_signed_name,
      caption: `Penney Construction, Inc.${a.penney_signed_name ? ` - ${a.penney_signed_name}${a.penney_signed_title ? `, ${a.penney_signed_title}` : ""}` : ""}`,
      date: a.penney_signed_at ? etDateShort(a.penney_signed_at) : null,
    },
  );

  if (a.penney_signed_at) {
    pdf.recordBox("PENNEY SIGNATURE", [
      `Signed for Penney Construction, Inc. by ${a.penney_signed_name ?? ""}${a.penney_signed_title ? `, ${a.penney_signed_title}` : ""}, ${etDateTimeLong(a.penney_signed_at)}.`,
    ]);
  }

  if (includeSub) {
    const lines = [
      `Signed by: ${a.sub_signed_name ?? ""}, for ${sub.company_name}`,
      `Date and time: ${etDateTimeLong(a.sub_signed_at)}`,
      ...(phoneEnding(a.sub_signed_phone) ? [`Sub portal login: ${phoneEnding(a.sub_signed_phone)}`] : []),
      ...(a.sub_signed_ip ? [`IP address: ${a.sub_signed_ip}`] : []),
      ...(a.sub_signed_ua ? [`Device: ${a.sub_signed_ua.slice(0, 160)}`] : []),
      ...(a.esign_consent_at ? [`Consent to sign electronically: ${etDateTimeLong(a.esign_consent_at)}`] : []),
      ...(a.pdf_sha256 ? [`Document reviewed and signed (SHA-256 of the copy Penney sent): ${a.pdf_sha256}`] : []),
    ];
    pdf.recordBox(
      "ELECTRONIC SIGNATURE RECORD",
      lines,
      "The Subcontractor reviewed this document in the Penney sub portal, consented to sign electronically, and adopted the typed name above as its signature. Executed electronically under the federal ESIGN Act and M.G.L. c.110G; an electronic signature has the same legal effect as a handwritten one. Penney keeps this record and the Subcontractor can download it from the sub portal.",
    );
  }

  if (a.signed_on_paper) {
    pdf.recordBox("SIGNED ON PAPER", [
      `Signed on paper by ${a.sub_signed_name ?? "the Subcontractor"}${a.sub_signed_at ? ` on ${etDateShort(a.sub_signed_at)}` : ""}. The signed paper copy is on file with Penney.`,
    ]);
  }

  return pdf.finish();
}

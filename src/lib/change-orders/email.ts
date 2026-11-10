/**
 * The email a client gets with a change order: one builder, so the wording is
 * the same whether it is sent from the app's Send button or from the Penney
 * MCP (Claude / ChatGPT).
 */

/** Every change order send copies the office: Ryan, Nicole and Jorge. */
export const CHANGE_ORDER_INTERNAL_CC: readonly string[] = [
  "rpenney@penneyconstructioninc.com", // Ryan
  "nsmith@penneyconstructioninc.com", // Nicole
  "jbetancur@penneyconstructioninc.com", // Jorge
];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$494.00" for an add, "Credit: $1,500.00" for a credit. Always to the penny. */
export function changeOrderAmountLine(priceImpact: number): string {
  return priceImpact < 0 ? `Credit: ${usd.format(Math.abs(priceImpact))}` : `Amount: ${usd.format(priceImpact)}`;
}

export interface ChangeOrderEmailInput {
  changeOrderNumber: number;
  title: string;
  priceImpact: number;
  approvalToken: string;
  projectName: string | null;
  clientFirstName: string | null;
  /** e.g. https://www.penneyconstruction.build */
  origin: string;
}

export interface ChangeOrderEmail {
  cc: string;
  subject: string;
  body: string;
  attachmentFilename: string;
  approvalUrl: string;
}

export function buildChangeOrderEmail(input: ChangeOrderEmailInput): ChangeOrderEmail {
  const projectName = input.projectName || "Project";
  const approvalUrl = `${input.origin}/approve/${input.approvalToken}`;
  const body = `Hi ${input.clientFirstName || "there"},

Please review the attached Change Order #${input.changeOrderNumber} for ${input.projectName || "your project"}.

${input.title}
${changeOrderAmountLine(input.priceImpact)}

To approve this change order, please click the link below and sign:

${approvalUrl}

Thank you,`;

  return {
    cc: CHANGE_ORDER_INTERNAL_CC.join(", "),
    subject: `Change Order #${input.changeOrderNumber} — ${projectName} | Penney Construction`,
    body,
    // A slash or colon in a title would break the attachment name.
    attachmentFilename: `CO${input.changeOrderNumber} - ${input.title.replace(/[\\/:*?"<>|]+/g, " ").trim()}.pdf`,
    approvalUrl,
  };
}

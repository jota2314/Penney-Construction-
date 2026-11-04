import { inquiryText, type Inquiry } from "./model";

export const INQUIRY_EMAIL_TEMPLATES = [
  { id: "initial", label: "First response" },
  { id: "follow_up", label: "Follow up" },
  { id: "details", label: "Request details" },
] as const;

export type InquiryEmailTemplateId = typeof INQUIRY_EMAIL_TEMPLATES[number]["id"];

const PROJECT_NAMES: Record<string, string> = {
  addition: "addition", adu: "ADU", kitchen: "kitchen", bathroom: "bathroom",
  "whole-home": "whole-home renovation", "lower-level": "lower-level renovation",
  "porch-deck": "porch or deck", historic: "historic renovation", exterior: "exterior renovation",
};

function oneLine(value: string, max = 100): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Local starting text only. Choosing a template never sends or saves a message. */
export function buildInquiryEmailDraft(
  inquiry: Inquiry,
  templateId: InquiryEmailTemplateId,
  senderName: string,
): { subject: string; body: string } {
  const firstName = oneLine(inquiryText(inquiry, "name")).split(" ")[0];
  const sender = oneLine(senderName).split(" ")[0] || "Penney Construction";
  const kind = PROJECT_NAMES[inquiryText(inquiry, "projectType")] || "renovation";
  const town = oneLine(inquiryText(inquiry, "town"));
  const project = `${kind} project${town ? ` in ${town}` : ""}`;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  let message: string;
  if (templateId === "follow_up") {
    message = `Following up on your ${project}. Are you still looking to move forward? Let me know a good time for a quick call to discuss the next steps.`;
  } else if (templateId === "details") {
    const context = inquiry.website_inquiry?.propertyContext as { property?: { address?: unknown } } | undefined;
    const hasAddress = typeof context?.property?.address === "string" && !!context.property.address.trim();
    const requests = [
      ...(!hasAddress ? ["The property address"] : []),
      "A few photos or drawings of the space",
      "The main changes you would like to make",
      ...(!inquiryText(inquiry, "timeline") ? ["Your preferred timing"] : []),
    ];
    message = `Thanks for reaching out about your ${project}. Can you send the following so we can take a closer look?\n\n${requests.map((request) => `- ${request}`).join("\n")}`;
  } else {
    message = `Thanks for reaching out about your ${project}. What would be a good time for a quick call to go over the scope, timing, and next steps?`;
  }

  return {
    subject: `${templateId === "follow_up" ? "Following up: " : ""}Your ${project} | Penney Construction`,
    body: `${greeting}\n\n${message}\n\nThanks,\n${sender}`,
  };
}

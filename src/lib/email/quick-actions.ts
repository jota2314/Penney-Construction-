/**
 * Pure rules-based quick-action chips derived from a classified email row.
 * No AI call. Used by EmailChatPanel summary card.
 *
 * Each chip carries an `intent`:
 *  - "quick_reply"       → opens the Quick Reply bottom sheet (AI draft)
 *  - "approve_quote"     → tells AI to save this email as a quote on the matched project
 *  - "save_to_project"   → links the email + saves attachments to the matched project
 *  - "create_payment"    → records a payment from this email
 *  - "create_customer"   → creates a customer from the sender
 *  - "mark_done"         → just marks email processed
 *
 * The chip's `prompt` is what gets sent into /api/email-chat when the chip is
 * tapped (except "quick_reply" and "mark_done", which are handled directly).
 */

export type QuickActionIntent =
  | "quick_reply"
  | "approve_quote"
  | "save_to_project"
  | "create_payment"
  | "create_customer"
  | "mark_done";

export interface QuickAction {
  id: string;
  label: string;
  intent: QuickActionIntent;
  /** Message sent into the AI chat to trigger this. Empty for direct intents. */
  prompt: string;
  /** Visual emphasis. "primary" = orange, "default" = neutral, "ghost" = subtle. */
  variant: "primary" | "default" | "ghost";
}

interface ClassifiedEmailLite {
  sender_type?: string | null;
  urgency?: string | null;
  content_type?: string | null;
  ai_action_required?: boolean | null;
  matched_customer_id?: string | null;
  matched_subcontractor_id?: string | null;
  matched_project_id?: string | null;
}

export function deriveQuickActions(email: ClassifiedEmailLite): QuickAction[] {
  const actions: QuickAction[] = [];

  // Spam → just mark done
  if (email.sender_type === "spam" || email.urgency === "junk") {
    actions.push({
      id: "mark_done",
      label: "Mark done",
      intent: "mark_done",
      prompt: "",
      variant: "default",
    });
    return actions;
  }

  const replyPrimary = email.ai_action_required === true;

  switch (email.content_type) {
    case "quote": {
      if (email.matched_subcontractor_id) {
        actions.push({
          id: "approve_quote",
          label: "Save quote",
          intent: "approve_quote",
          prompt:
            "Save this email as a quote on the matched project. Extract amount, trade, scope, and link the PDF attachment using its storage_path.",
          variant: replyPrimary ? "default" : "primary",
        });
      } else {
        actions.push({
          id: "save_quote_unmatched",
          label: "Save quote",
          intent: "approve_quote",
          prompt:
            "Save this email as a quote. Extract amount, trade, scope, and tell me which project it should link to. Include attachment_storage_path.",
          variant: replyPrimary ? "default" : "primary",
        });
      }
      if (email.matched_project_id) {
        actions.push({
          id: "save_to_project_quote",
          label: "Save to project",
          intent: "save_to_project",
          prompt:
            "Link this email to the matched project and save any attached files to the project's quotes folder.",
          variant: "default",
        });
      }
      break;
    }

    case "invoice": {
      if (email.matched_project_id) {
        actions.push({
          id: "save_invoice",
          label: "Save invoice",
          intent: "save_to_project",
          prompt:
            "Save this email as an invoice on the matched project. Extract vendor, amount, invoice_number, invoice_date, due_date. Link the PDF using its storage_path.",
          variant: replyPrimary ? "default" : "primary",
        });
      } else {
        actions.push({
          id: "save_invoice_unmatched",
          label: "Save invoice",
          intent: "save_to_project",
          prompt:
            "Save this email as an invoice. Extract vendor, amount, invoice_number, invoice_date, due_date. Ask me which project it belongs to.",
          variant: replyPrimary ? "default" : "primary",
        });
      }
      actions.push({
        id: "create_payment",
        label: "Create payment",
        intent: "create_payment",
        prompt:
          "Create a payment record for this invoice on the matched project. Use the invoice amount and date as defaults.",
        variant: "default",
      });
      break;
    }

    case "payment_receipt": {
      actions.push({
        id: "record_receipt",
        label: "Record payment",
        intent: "create_payment",
        prompt:
          "Record this received payment. Extract amount, date, payment_type (deposit/draw/progress/final), and method.",
        variant: replyPrimary ? "default" : "primary",
      });
      break;
    }

    case "inquiry": {
      if (!email.matched_customer_id) {
        actions.push({
          id: "create_customer",
          label: "Create customer",
          intent: "create_customer",
          prompt:
            "Create a customer from this sender. Extract first_name, last_name, email, phone, address. Then create a project lead from this inquiry.",
          variant: replyPrimary ? "default" : "primary",
        });
      } else if (email.matched_project_id) {
        actions.push({
          id: "save_to_project_inquiry",
          label: "Save to project",
          intent: "save_to_project",
          prompt: "Link this email to the matched project.",
          variant: "default",
        });
      }
      break;
    }

    case "schedule":
    case "contract":
    case "update": {
      if (email.matched_project_id) {
        actions.push({
          id: "save_to_project_misc",
          label: "Save to project",
          intent: "save_to_project",
          prompt:
            "Link this email to the matched project. If there are attachments, save them to the project files.",
          variant: "default",
        });
      }
      break;
    }

    default:
      break;
  }

  // Draft reply — primary if action_required, otherwise secondary
  actions.push({
    id: "quick_reply",
    label: "Draft reply",
    intent: "quick_reply",
    prompt: "",
    variant: replyPrimary ? "primary" : "default",
  });

  // Always offer a way out
  actions.push({
    id: "mark_done",
    label: "Mark done",
    intent: "mark_done",
    prompt: "",
    variant: "ghost",
  });

  // Cap at 4 chips
  return actions.slice(0, 4);
}

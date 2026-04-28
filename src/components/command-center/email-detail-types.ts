// ── Shared types for email-detail components ────────────────────
import {
  FolderPlus,
  Pencil,
  UserPlus,
  DollarSign,
  Bell,
  Link2,
  Reply,
  SkipForward,
  CalendarPlus,
} from "lucide-react";

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  storage_path: string | null;
  text_content?: string;
}

export interface StoredEmail {
  id: string;
  gmail_message_id: string;
  thread_id: string | null;
  subject: string;
  from_name: string;
  from_email: string;
  to_name: string;
  to_email: string;
  date: string;
  direction: string;
  body: string;
  snippet: string;
  is_processed: boolean;
  project_id: string | null;
  attachments: AttachmentMeta[];
  // Haiku classifier fields (cron writes these on arrival; may be null
  // for pre-classifier imports — UI calls /api/email/classify-one to backfill).
  ai_classified_at?: string | null;
  sender_type?: string | null;
  urgency?: string | null;
  ai_summary?: string | null;
  ai_action_required?: boolean | null;
  content_type?: string | null;
  matched_customer_id?: string | null;
  matched_subcontractor_id?: string | null;
  matched_project_id?: string | null;
}

export interface ProjectRef {
  id: string;
  name: string;
  status: string;
  project_type: string;
}

export interface ProposedAction {
  id: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
  status: "pending" | "executing" | "approved" | "error";
  error?: string;
}

export interface DisplayMessage {
  dbId?: string; // conversation_messages ID for persisting action status
  role: "user" | "assistant";
  content: string;
  proposedActions?: ProposedAction[];
}

export interface ExistingConversation {
  id: string;
  messages: {
    id: string;
    role: string;
    content: string;
    source: string | null;
    metadata: Record<string, unknown> | null;
  }[];
}

export interface MatchedEntityNames {
  customer: string | null;
  sub: string | null;
  project: string | null;
}

export interface EmailDetailProps {
  email: StoredEmail;
  projects: ProjectRef[];
  userName: string;
  existingConversation: ExistingConversation | null;
  backUrl?: string;
  matchedNames?: MatchedEntityNames;
}

// ── Draft & View Mode ───────────────────────────────────────────

export interface DraftAttachment {
  filename: string;
  mimeType: string;
  storagePath: string;
  size: number;
  /** Base64 content for files uploaded from computer (not in Supabase) */
  content?: string;
}

export interface DraftState {
  /** ID of the ProposedAction this draft originated from */
  sourceActionId: string;
  /** Index of the message containing the source action */
  sourceMsgIndex: number;
  /** Index of the action within that message */
  sourceActionIndex: number;
  to: string;
  toName: string;
  cc: string;
  subject: string;
  body: string;
  attachments: DraftAttachment[];
}

export type ViewMode = "split" | "email" | "chat";

// ── Constants ────────────────────────────────────────────────────

export const ACTION_ICONS: Record<string, React.ElementType> = {
  create_project: FolderPlus,
  update_project: Pencil,
  create_customer: UserPlus,
  create_subcontractor: UserPlus,
  create_quote: DollarSign,
  create_todo: Bell,
  schedule_event: CalendarPlus,
  link_email_to_project: Link2,
  draft_reply: Reply,
  skip: SkipForward,
};

export const SUGGESTIONS: string[] = [];

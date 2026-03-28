"use server";

import { createClient } from "@/lib/supabase/server";

export interface Conversation {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  source: "text" | "voice";
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function getConversations(projectId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Conversation[];
}

export async function getConversationMessages(conversationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data || []) as ConversationMessage[];
}

export async function deleteConversation(conversationId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId);

  if (error) throw error;
}

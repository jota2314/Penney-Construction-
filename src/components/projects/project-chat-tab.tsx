"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bot,
  Send,
  Loader2,
  User,
} from "lucide-react";
import type { Project, Customer, Estimate, QuoteRequest } from "@/types/database";
import type { LinkedEmail, ChatMessage } from "@/components/projects/project-detail-tabs";
import { ChatAttachments, type ChatAttachment } from "@/components/chat/chat-attachments";

interface ProjectChatTabProps {
  project: Project;
  customer: Customer | null;
  linkedEmails: LinkedEmail[];
  quoteRequests: QuoteRequest[];
  estimates: Estimate[];
}

export function ProjectChatTab({
  project,
  customer,
  linkedEmails,
  quoteRequests,
  estimates,
}: ProjectChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  async function handleSend(overrideText?: string) {
    const text = (overrideText || input).trim();
    if (!text && attachments.length === 0) return;
    if (loading) return;

    const currentAttachments = [...attachments];
    if (!overrideText) { setInput(""); setAttachments([]); }

    const displayText = text || `(${currentAttachments.map(a => a.filename).join(", ")})`;
    const userMsg: ChatMessage = { role: "user", content: displayText };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setTimeout(scrollToBottom, 50);

    try {
      // Build project context for the AI
      const context = buildProjectContext(project, customer, linkedEmails, quoteRequests, estimates);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: context + "\n\nUser question: " + (text || "See attached files"),
          projectId: project.id,
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to connect to AI");

      // Handle streaming SSE response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === "text" && parsed.content) {
                assistantContent += parsed.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", content: assistantContent };
                  return updated;
                });
                scrollToBottom();
              }
            } catch {
              // partial JSON, skip
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev.filter((m) => m.content !== ""),
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Failed"}` },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  const suggestions = [
    "Summarize this project",
    "What quotes are missing?",
    "Draft a follow-up email to the client",
    "What's the next step for this project?",
    "List all trades needed",
  ];

  return (
    <div className="flex flex-col h-[60vh] min-h-[400px] border rounded-lg overflow-hidden">
      {/* Chat header */}
      <div className="p-3 border-b bg-muted/30 flex items-center gap-2">
        <Bot className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">AI Assistant</span>
        <span className="text-[10px] text-muted-foreground">— {project.name}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="text-center py-8 space-y-3">
            <Bot className="h-8 w-8 text-amber-500/50 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Ask me anything about <span className="font-medium text-foreground">{project.name}</span>
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-[10px] px-2.5 py-1 rounded-full bg-muted hover:bg-amber-500/10 hover:text-amber-500 text-muted-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && <Bot className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />}
            <div className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
              msg.role === "user" ? "bg-amber-500/20" : "bg-muted"
            }`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === "user" && <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />}
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-2">
            <Bot className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t">
        {attachments.length > 0 && (
          <div className="mb-2">
            <ChatAttachments
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              projectId={project.id}
              disabled={loading}
            />
          </div>
        )}
        <div className="flex gap-2 items-end">
          {attachments.length === 0 && (
            <ChatAttachments
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              projectId={project.id}
              disabled={loading}
            />
          )}
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Ask about ${project.name}...`}
            disabled={loading}
            className="text-sm"
          />
          <Button onClick={() => handleSend()} disabled={loading || (!input.trim() && attachments.length === 0)} size="icon" className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Build project context for AI ──────────────────────────

function buildProjectContext(
  project: Project,
  customer: Customer | null,
  emails: LinkedEmail[],
  quotes: QuoteRequest[],
  estimates: Estimate[],
): string {
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : "Unknown";
  const address = [project.address, project.city, project.state].filter(Boolean).join(", ");

  let context = `You are the AI assistant for Penney Construction, a residential general contractor on the North Shore of Massachusetts.
You are helping with project "${project.name}" (${project.project_number}).

PROJECT DETAILS:
- Name: ${project.name}
- Number: ${project.project_number}
- Status: ${project.status}
- Type: ${project.project_type}
- Client: ${customerName}${customer?.email ? ` (${customer.email})` : ""}${customer?.phone ? `, ${customer.phone}` : ""}
- Address: ${address || "N/A"}
- Estimated Value: ${project.estimated_value ? `$${project.estimated_value.toLocaleString()}` : "N/A"}
- Contract Value: ${project.contract_value ? `$${project.contract_value.toLocaleString()}` : "N/A"}
- Description: ${project.description || "N/A"}
- Notes: ${project.notes || "None"}
`;

  if (estimates.length > 0) {
    context += `\nESTIMATES (${estimates.length}):\n`;
    for (const est of estimates) {
      context += `- ${est.name} v${est.version}: $${est.total_price.toLocaleString()} (${est.status})\n`;
    }
  }

  if (quotes.length > 0) {
    context += `\nSUB QUOTES (${quotes.length}):\n`;
    for (const q of quotes) {
      context += `- ${q.subcontractor_name} (${q.trade || "N/A"}): ${q.amount ? `$${q.amount.toLocaleString()}` : "No amount"} — ${q.status}\n`;
      if (q.scope_description) context += `  Scope: ${q.scope_description}\n`;
    }
  }

  if (emails.length > 0) {
    context += `\nRECENT EMAILS (${emails.length}):\n`;
    for (const e of emails.slice(0, 10)) {
      const dir = e.direction === "inbound" ? "FROM" : "TO";
      const person = e.direction === "inbound" ? (e.from_name || e.from_email) : (e.to_name || e.to_email);
      context += `- [${new Date(e.date).toLocaleDateString()}] ${dir} ${person}: ${e.subject}\n`;
      if (e.snippet) context += `  "${e.snippet.substring(0, 100)}"\n`;
    }
  }

  context += `\nBe helpful, concise, and think like a construction estimator/PM. When drafting emails, use professional but friendly tone. Reference specific project details.`;

  return context;
}

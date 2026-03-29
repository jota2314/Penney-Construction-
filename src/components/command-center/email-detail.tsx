"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
  Send,
  Loader2,
  Bot,
  User,
  CheckCircle,
  FileText,
} from "lucide-react";

interface StoredEmail {
  id: string;
  gmail_message_id: string;
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
  attachments: { filename: string; mimeType: string; size: number; storage_path: string | null }[];
}

interface ProjectRef {
  id: string;
  name: string;
  status: string;
  project_type: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface EmailDetailProps {
  email: StoredEmail;
  projects: ProjectRef[];
}

export function EmailDetail({ email, projects }: EmailDetailProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [processed, setProcessed] = useState(email.is_processed);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/analyze-single-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: email.gmail_message_id,
          userInstruction: text,
        }),
      });
      const data = await res.json();

      if (data.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${data.error}` }]);
      } else {
        // Format AI response
        const analysis = data.analysis;
        let response = analysis.summary || "Analyzed.";

        if (analysis.actions && analysis.actions.length > 0) {
          const actionLines = analysis.actions
            .filter((a: { type: string; data?: Record<string, unknown> }) => a.data && a.type !== "skip")
            .map((a: { type: string; data: Record<string, unknown> }) => {
              switch (a.type) {
                case "create_project":
                  return `📁 Create project: **${a.data.name}** (${a.data.project_type}, ${a.data.status})${a.data.address ? ` at ${a.data.address}` : ""}`;
                case "create_customer":
                  return `👤 Create client: **${a.data.first_name} ${a.data.last_name}**${a.data.email ? ` <${a.data.email}>` : ""}${a.data.phone ? ` ${a.data.phone}` : ""}`;
                case "create_subcontractor":
                  return `🔧 Create sub: **${a.data.company_name}** — ${((a.data.trades as string[]) || []).join(", ")}`;
                case "create_quote":
                  return `💰 Quote: **${a.data.subcontractor_name}** → ${a.data.project_name}${a.data.amount ? ` $${Number(a.data.amount).toLocaleString()}` : ""}`;
                case "create_follow_up":
                  return `📋 Follow-up: **${a.data.contact_name}** — ${a.data.description}`;
                case "log_email":
                  return `📧 Log to: **${a.data.project_name || "general"}**`;
                default:
                  return null;
              }
            })
            .filter(Boolean);

          if (actionLines.length > 0) {
            response += "\n\n" + actionLines.join("\n");
          }

          response += "\n\nType **save** to execute these actions, or tell me what to change.";
        }

        setMessages((prev) => [...prev, { role: "assistant", content: response }]);

        // If user said "save" or "approve" or "yes", execute the actions
        const lowerText = text.toLowerCase();
        if (["save", "approve", "yes", "do it", "go", "confirm"].includes(lowerText) && data.analysis?.actions) {
          const { saveApprovedDraft } = await import("@/lib/actions/ai-email-engine");
          const actions = data.analysis.actions.filter(
            (a: { type: string; data?: unknown }) => a.type !== "skip" && a.data
          );
          if (actions.length > 0) {
            const result = await saveApprovedDraft(actions);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Done! Created: ${result.projectsCreated} projects, ${result.customersCreated} customers, ${result.subsCreated} subs, ${result.quotesCreated} quotes, ${result.followUpsCreated} follow-ups.`,
              },
            ]);

            // Mark as processed
            const { createClient } = await import("@/lib/supabase/client");
            const supabase = createClient();
            await supabase.from("inbox_emails").update({ is_processed: true }).eq("id", email.id);
            setProcessed(true);
            router.refresh();
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Failed"}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: Email content */}
      <div className="flex-1 flex flex-col min-w-0 border-r">
        {/* Email header */}
        <div className="p-4 border-b space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild className="shrink-0">
              <Link href="/command-center/emails"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <h2 className="font-semibold text-base truncate flex-1">{email.subject}</h2>
            {processed && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
            <div className={`p-1 rounded shrink-0 ${email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"}`}>
              {email.direction === "inbound"
                ? <ArrowDownLeft className="h-3.5 w-3.5 text-blue-400" />
                : <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />}
            </div>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5 ml-10">
            <p><span className="font-medium">From:</span> {email.from_name} &lt;{email.from_email}&gt;</p>
            <p><span className="font-medium">To:</span> {email.to_name} &lt;{email.to_email}&gt;</p>
            <p>{new Date(email.date).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}</p>
          </div>
          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 ml-10">
              {email.attachments.map((att, i) => (
                <Badge key={i} variant="outline" className="text-[10px] gap-1 cursor-pointer hover:bg-muted">
                  {att.mimeType?.includes("pdf") ? <FileText className="h-2.5 w-2.5" /> : <Paperclip className="h-2.5 w-2.5" />}
                  {att.filename}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Email body */}
        <div className="flex-1 overflow-y-auto p-4 ml-10">
          <div className="text-sm whitespace-pre-wrap text-muted-foreground max-w-2xl">
            {email.body || email.snippet || "No content"}
          </div>
        </div>
      </div>

      {/* Right: AI Chat */}
      <div className="w-96 flex flex-col bg-muted/30">
        {/* Chat header */}
        <div className="p-3 border-b">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">AI Assistant</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Tell me what this email is about. I&apos;ll help organize it.
          </p>
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8 space-y-3">
              <Bot className="h-8 w-8 text-amber-500/30 mx-auto" />
              <p className="text-xs text-muted-foreground">
                Try saying:
              </p>
              <div className="space-y-1.5">
                {[
                  "This is a new project",
                  "This is a quote for Gouthro",
                  "Log this to Colten Kitchen",
                  "Skip this email",
                  "What project is this for?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                    className="block w-full text-left text-xs px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
                  >
                    &quot;{suggestion}&quot;
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && (
                <Bot className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              )}
              <div className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                msg.role === "user"
                  ? "bg-amber-500/20 text-foreground"
                  : "bg-muted text-foreground"
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
              {msg.role === "user" && (
                <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <Bot className="h-5 w-5 text-amber-500 shrink-0" />
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <div className="p-3 border-t">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell me about this email..."
              disabled={loading}
              className="text-sm"
            />
            <Button onClick={handleSend} disabled={loading || !input.trim()} size="icon" className="shrink-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

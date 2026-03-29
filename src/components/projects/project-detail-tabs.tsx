"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LayoutDashboard,
  Mail,
  DollarSign,
  FolderOpen,
  Bot,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
  CheckCircle,
  FileText,
  Image as ImageIcon,
  Download,
  ExternalLink,
  Send,
  Loader2,
  User,
  MessageSquare,
  Eye,
} from "lucide-react";
import { ProjectDetail } from "./project-detail";
import type { ActivityItem } from "./project-activity-feed";
import type { Project, Customer, Estimate, QuoteRequest } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface ProjectMeeting {
  id: string;
  scheduled_at: string;
  status: string;
  address: string | null;
  city: string | null;
  summary: string | null;
}

interface LinkedEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  to_name: string;
  to_email: string;
  date: string;
  direction: string;
  snippet: string;
  is_processed: boolean;
  attachments: { filename: string; mimeType: string; size: number; storage_path: string | null }[];
}

interface ProjectFile {
  emailId: string;
  emailSubject: string;
  emailDate: string;
  filename: string;
  mimeType: string;
  size: number;
  storage_path: string | null;
}

interface ConversationRef {
  email_id: string;
  message_count: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ProjectDetailTabsProps {
  project: Project;
  customer: Customer | null;
  customers: Customer[];
  teamMembers: TeamMember[];
  pmName: string | null;
  estimatorName: string | null;
  estimates: Estimate[];
  activityItems: ActivityItem[];
  meetings: ProjectMeeting[];
  linkedEmails: LinkedEmail[];
  quoteRequests: QuoteRequest[];
  projectFiles: ProjectFile[];
  conversations: ConversationRef[];
}

const fmt = (val: number | null) =>
  val != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val)
    : "—";

// ── Main Component ───────────────────────────────────────────

export function ProjectDetailTabs({
  project,
  customer,
  customers,
  teamMembers,
  pmName,
  estimatorName,
  estimates,
  activityItems,
  meetings,
  linkedEmails,
  quoteRequests,
  projectFiles,
  conversations,
}: ProjectDetailTabsProps) {
  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
        <TabsTrigger value="overview" className="gap-1.5 text-xs sm:text-sm">
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Overview</span>
        </TabsTrigger>
        <TabsTrigger value="emails" className="gap-1.5 text-xs sm:text-sm">
          <Mail className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Emails</span>
          {linkedEmails.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {linkedEmails.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="quotes" className="gap-1.5 text-xs sm:text-sm">
          <DollarSign className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Quotes</span>
          {quoteRequests.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {quoteRequests.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="files" className="gap-1.5 text-xs sm:text-sm">
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Files</span>
          {projectFiles.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {projectFiles.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="ai" className="gap-1.5 text-xs sm:text-sm">
          <Bot className="h-3.5 w-3.5 text-amber-500" />
          <span className="hidden sm:inline">AI</span>
        </TabsTrigger>
      </TabsList>

      {/* ── Overview Tab ── */}
      <TabsContent value="overview">
        <ProjectDetail
          project={project}
          customer={customer}
          customers={customers}
          teamMembers={teamMembers}
          pmName={pmName}
          estimatorName={estimatorName}
          estimates={estimates}
          activityItems={activityItems}
          meetings={meetings}
        />
      </TabsContent>

      {/* ── Emails Tab ── */}
      <TabsContent value="emails">
        <ProjectEmailsTab
          emails={linkedEmails}
          conversations={conversations}
          projectName={project.name}
        />
      </TabsContent>

      {/* ── Quotes Tab ── */}
      <TabsContent value="quotes">
        <ProjectQuotesTab
          quotes={quoteRequests}
          projectName={project.name}
        />
      </TabsContent>

      {/* ── Files Tab ── */}
      <TabsContent value="files">
        <ProjectFilesTab files={projectFiles} />
      </TabsContent>

      {/* ── AI Chat Tab ── */}
      <TabsContent value="ai">
        <ProjectAITab
          project={project}
          customer={customer}
          linkedEmails={linkedEmails}
          quoteRequests={quoteRequests}
          estimates={estimates}
        />
      </TabsContent>
    </Tabs>
  );
}

// ── Emails Tab ──────────────────────────────────────────────

function ProjectEmailsTab({
  emails,
  conversations,
  projectName,
}: {
  emails: LinkedEmail[];
  conversations: ConversationRef[];
  projectName: string;
}) {
  const router = useRouter();
  const convoMap = new Map(conversations.map((c) => [c.email_id, c.message_count]));

  if (emails.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No emails linked to {projectName}</p>
        <p className="text-sm mt-1">Emails get linked when the AI processes them and matches them to this project</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Email History
        </h3>
        <Badge variant="secondary" className="text-xs">
          {emails.length} email{emails.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="border rounded-lg divide-y overflow-hidden">
        {emails.map((email) => {
          const msgCount = convoMap.get(email.id) ?? 0;
          return (
            <button
              key={email.id}
              onClick={() => router.push(`/command-center/email/${email.id}`)}
              className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3"
            >
              <div className={`p-1.5 rounded shrink-0 mt-0.5 ${
                email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"
              }`}>
                {email.direction === "inbound"
                  ? <ArrowDownLeft className="h-3.5 w-3.5 text-blue-400" />
                  : <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{email.subject || "(no subject)"}</p>
                  {email.is_processed && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {email.direction === "inbound"
                    ? email.from_name || email.from_email
                    : `To: ${email.to_name || email.to_email}`}
                </p>
                <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{email.snippet}</p>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <div className="flex gap-1">
                  {email.attachments?.length > 0 && (
                    <Badge variant="outline" className="text-[9px] gap-0.5 px-1">
                      <Paperclip className="h-2.5 w-2.5" />
                      {email.attachments.length}
                    </Badge>
                  )}
                  {msgCount > 0 && (
                    <Badge variant="outline" className="text-[9px] gap-0.5 px-1 border-amber-500/30 text-amber-500">
                      <MessageSquare className="h-2.5 w-2.5" />
                      {msgCount}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Quotes Tab ──────────────────────────────────────────────

function ProjectQuotesTab({
  quotes,
  projectName,
}: {
  quotes: QuoteRequest[];
  projectName: string;
}) {
  if (quotes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No quotes for {projectName}</p>
        <p className="text-sm mt-1">Sub quotes get created when the AI processes emails with pricing</p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    received: "bg-green-500/20 text-green-400",
    awaiting_reply: "bg-amber-500/20 text-amber-400",
    just_sent: "bg-blue-500/20 text-blue-400",
    accepted: "bg-emerald-500/20 text-emerald-400",
    declined: "bg-red-500/20 text-red-400",
    in_progress: "bg-purple-500/20 text-purple-400",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Sub Quotes
        </h3>
        <Badge variant="secondary" className="text-xs">
          {quotes.length} quote{quotes.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="space-y-2">
        {quotes.map((q) => (
          <div key={q.id} className="border rounded-lg p-4 bg-card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{q.subcontractor_name}</p>
                {q.trade && (
                  <p className="text-xs text-muted-foreground capitalize">{q.trade}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {q.amount != null && (
                  <span className="text-sm font-bold text-green-500">{fmt(q.amount)}</span>
                )}
                <Badge className={`text-[10px] ${statusColors[q.status] ?? "bg-muted text-foreground"}`}>
                  {q.status.replace(/_/g, " ")}
                </Badge>
              </div>
            </div>
            {q.scope_description && (
              <p className="text-xs text-muted-foreground line-clamp-2">{q.scope_description}</p>
            )}
            {q.notes && (
              <p className="text-xs text-muted-foreground/70 italic">{q.notes}</p>
            )}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
              <span>Sent {new Date(q.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              {q.received_at && (
                <span>Received {new Date(q.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Files Tab ──────────────────────────────────────────────

function ProjectFilesTab({ files }: { files: ProjectFile[] }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<Map<string, string>>(new Map());

  async function handlePreview(file: ProjectFile) {
    if (!file.storage_path) return;
    setPreviewFilename(file.filename);
    setPreviewMimeType(file.mimeType);

    const supabase = createClient();
    const { data } = await supabase.storage
      .from("email-attachments")
      .createSignedUrl(file.storage_path, 3600);

    if (data?.signedUrl) {
      if (file.mimeType?.includes("pdf") || file.mimeType?.startsWith("image/")) {
        setPreviewUrl(data.signedUrl);
      } else {
        window.open(data.signedUrl, "_blank");
      }
    }
  }

  async function handleDownload(file: ProjectFile) {
    if (!file.storage_path) return;
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("email-attachments")
      .createSignedUrl(file.storage_path, 3600);
    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  }

  async function handleExtractText(file: ProjectFile) {
    if (!file.storage_path || extractedText.has(file.storage_path)) return;
    setExtracting(file.storage_path);
    try {
      const res = await fetch("/api/extract-attachment-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: file.emailId }),
      });
      const data = await res.json();
      if (data.attachments) {
        const newMap = new Map(extractedText);
        for (const att of data.attachments) {
          if (att.storage_path && att.text_content) {
            newMap.set(att.storage_path, att.text_content);
          }
        }
        setExtractedText(newMap);
      }
    } catch {
      // ignore
    } finally {
      setExtracting(null);
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (files.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No files yet</p>
        <p className="text-sm mt-1">Attachments from linked emails will appear here</p>
      </div>
    );
  }

  const pdfs = files.filter((f) => f.mimeType?.includes("pdf"));
  const images = files.filter((f) => f.mimeType?.startsWith("image/"));
  const other = files.filter((f) => !f.mimeType?.includes("pdf") && !f.mimeType?.startsWith("image/"));

  const renderFileCard = (file: ProjectFile) => {
    const isPdf = file.mimeType?.includes("pdf");
    const isImage = file.mimeType?.startsWith("image/");
    const text = file.storage_path ? extractedText.get(file.storage_path) : null;

    return (
      <div key={`${file.emailId}-${file.filename}`} className="border rounded-lg p-3 bg-card space-y-2">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${isPdf ? "bg-red-500/10" : isImage ? "bg-blue-500/10" : "bg-muted"}`}>
            {isPdf ? <FileText className="h-5 w-5 text-red-400" /> :
             isImage ? <ImageIcon className="h-5 w-5 text-blue-400" /> :
             <Paperclip className="h-5 w-5 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file.filename}</p>
            <p className="text-[10px] text-muted-foreground">
              {formatSize(file.size)} &middot; from &quot;{file.emailSubject}&quot;
            </p>
          </div>
        </div>

        <div className="flex gap-1.5">
          {file.storage_path && (isPdf || isImage) && (
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handlePreview(file)}>
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
          )}
          {file.storage_path && (
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={() => handleDownload(file)}>
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          )}
          {isPdf && file.storage_path && !text && (
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] h-7"
              onClick={() => handleExtractText(file)}
              disabled={extracting === file.storage_path}
            >
              {extracting === file.storage_path ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <FileText className="h-3 w-3 mr-1" />
              )}
              OCR
            </Button>
          )}
        </div>

        {text && (
          <div className="bg-muted rounded p-2 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
            {text.substring(0, 2000)}
            {text.length > 2000 && "..."}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {pdfs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" />
            PDFs
            <Badge variant="secondary" className="text-[9px]">{pdfs.length}</Badge>
          </h3>
          <div className="grid gap-2">{pdfs.map(renderFileCard)}</div>
        </div>
      )}

      {images.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <ImageIcon className="h-3.5 w-3.5" />
            Images
            <Badge variant="secondary" className="text-[9px]">{images.length}</Badge>
          </h3>
          <div className="grid gap-2">{images.map(renderFileCard)}</div>
        </div>
      )}

      {other.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Paperclip className="h-3.5 w-3.5" />
            Other Files
            <Badge variant="secondary" className="text-[9px]">{other.length}</Badge>
          </h3>
          <div className="grid gap-2">{other.map(renderFileCard)}</div>
        </div>
      )}

      {/* Preview dialog */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent
          className="max-w-4xl h-[85vh] flex flex-col p-0"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm font-medium truncate">{previewFilename}</DialogTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => window.open(previewUrl!, "_blank")}>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                <a href={previewUrl!} download={previewFilename}>
                  <Download className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-4 pb-4">
            {previewMimeType?.includes("pdf") ? (
              <iframe src={previewUrl!} className="w-full h-full rounded border" title={previewFilename} />
            ) : previewMimeType?.startsWith("image/") ? (
              <img src={previewUrl!} alt={previewFilename} className="max-w-full max-h-full object-contain mx-auto" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── AI Chat Tab ──────────────────────────────────────────────

function ProjectAITab({
  project,
  customer,
  linkedEmails,
  quoteRequests,
  estimates,
}: {
  project: Project;
  customer: Customer | null;
  linkedEmails: LinkedEmail[];
  quoteRequests: QuoteRequest[];
  estimates: Estimate[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  async function handleSend(overrideText?: string) {
    const text = (overrideText || input).trim();
    if (!text || loading) return;

    if (!overrideText) setInput("");
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setTimeout(scrollToBottom, 50);

    try {
      // Build project context for the AI
      const context = buildProjectContext(project, customer, linkedEmails, quoteRequests, estimates);
      const history = [...messages, userMsg];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: context + "\n\nUser question: " + text,
          projectId: project.id,
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
        <div className="flex gap-2">
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
          <Button onClick={() => handleSend()} disabled={loading || !input.trim()} size="icon" className="shrink-0">
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

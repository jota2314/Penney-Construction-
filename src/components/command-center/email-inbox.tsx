"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Paperclip,
  CheckCircle,
  Mail,
} from "lucide-react";
import { useRouter } from "next/navigation";

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
  snippet: string;
  is_processed: boolean;
  project_id: string | null;
  attachments: { filename: string; mimeType: string; storage_path: string | null }[];
}

interface EmailInboxProps {
  initialEmails: StoredEmail[];
  totalCount: number;
  unprocessedCount: number;
}

export function EmailInbox({ initialEmails, totalCount, unprocessedCount }: EmailInboxProps) {
  const [emails, setEmails] = useState<StoredEmail[]>(initialEmails);
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  async function handleFetchMore() {
    setFetching(true);
    setResult(null);
    try {
      const res = await fetch("/api/fetch-and-store-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data.message);
      router.refresh();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed");
    } finally {
      setFetching(false);
    }
  }

  function handleEmailClick(email: StoredEmail) {
    router.push(`/command-center/email/${email.id}`);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-lg font-semibold shrink-0">Inbox</h2>
          <Badge variant="secondary" className="text-xs shrink-0">{totalCount}</Badge>
          {unprocessedCount > 0 && (
            <Badge variant="secondary" className="text-xs bg-amber-500/20 text-amber-400 shrink-0">
              {unprocessedCount} new
            </Badge>
          )}
          {result && <p className="text-[10px] text-muted-foreground truncate">{result}</p>}
        </div>
        <Button onClick={handleFetchMore} disabled={fetching} variant="outline" size="sm" className="shrink-0">
          {fetching ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
          {fetching ? "..." : "Fetch"}
        </Button>
      </div>

      {/* Email list */}
      {emails.length > 0 ? (
        <div className="border rounded-lg divide-y overflow-hidden">
          {emails.map((email) => (
            <button
              key={email.id}
              onClick={() => handleEmailClick(email)}
              className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3 ${
                email.is_processed ? "opacity-40" : ""
              }`}
            >
              {/* Direction */}
              <div className={`p-1.5 rounded shrink-0 mt-0.5 ${
                email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"
              }`}>
                {email.direction === "inbound"
                  ? <ArrowDownLeft className="h-3.5 w-3.5 text-blue-400" />
                  : <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm truncate ${email.is_processed ? "" : "font-medium"}`}>
                    {email.subject || "(no subject)"}
                  </p>
                  {email.is_processed && (
                    <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {email.direction === "inbound"
                    ? email.from_name || email.from_email
                    : `To: ${email.to_name || email.to_email}`}
                </p>
                <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                  {email.snippet}
                </p>
              </div>

              {/* Right */}
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <div className="flex gap-1">
                  {email.attachments && email.attachments.length > 0 && (
                    <Badge variant="outline" className="text-[9px] gap-0.5 px-1">
                      <Paperclip className="h-2.5 w-2.5" />
                      {email.attachments.length}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No emails stored yet</p>
          <p className="text-sm mt-1">Click "Fetch More" to pull from Gmail</p>
        </div>
      )}
    </div>
  );
}

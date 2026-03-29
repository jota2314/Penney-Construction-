"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import {
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Paperclip,
  CheckCircle,
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

export function EmailInbox() {
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [emails, setEmails] = useState<StoredEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Load stored emails from Supabase on mount
  useEffect(() => {
    loadEmails();
  }, []);

  async function loadEmails() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("inbox_emails")
      .select("*")
      .order("date", { ascending: false });
    setEmails((data as StoredEmail[]) || []);
    setLoading(false);
  }

  async function handleFetchEmails() {
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
      await loadEmails(); // reload the list
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed");
    } finally {
      setFetching(false);
    }
  }

  function handleEmailClick(email: StoredEmail) {
    // Navigate to email detail page where AI chat will happen
    router.push(`/command-center/email/${email.id}`);
  }

  const unprocessed = emails.filter((e) => !e.is_processed).length;

  return (
    <div className="space-y-4">
      {/* Header with fetch button */}
      <div className="flex items-center justify-between">
        <div>
          {emails.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {emails.length} emails stored{unprocessed > 0 && ` · ${unprocessed} unreviewed`}
            </p>
          )}
          {result && <p className="text-xs text-muted-foreground mt-0.5">{result}</p>}
        </div>
        <Button
          onClick={handleFetchEmails}
          disabled={fetching}
          variant="outline"
          size="sm"
          className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
        >
          {fetching
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <Download className="h-4 w-4 mr-2" />}
          {fetching ? "Fetching..." : "Fetch Emails"}
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Email list */}
      {!loading && emails.length > 0 && (
        <div className="border rounded-lg divide-y max-h-[500px] overflow-y-auto">
          {emails.map((email) => (
            <button
              key={email.id}
              onClick={() => handleEmailClick(email)}
              className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3 ${
                email.is_processed ? "opacity-50" : ""
              }`}
            >
              {/* Direction icon */}
              <div className={`p-1 rounded shrink-0 mt-0.5 ${
                email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"
              }`}>
                {email.direction === "inbound"
                  ? <ArrowDownLeft className="h-3.5 w-3.5 text-blue-400" />
                  : <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{email.subject || "(no subject)"}</p>
                  {email.is_processed && (
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {email.direction === "inbound"
                    ? `From: ${email.from_name || email.from_email}`
                    : `To: ${email.to_name || email.to_email}`}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {email.snippet}
                </p>
              </div>

              {/* Right side */}
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                {email.attachments && email.attachments.length > 0 && (
                  <Badge variant="outline" className="text-[9px] gap-0.5">
                    <Paperclip className="h-2.5 w-2.5" />
                    {email.attachments.length}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && emails.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No emails stored yet.</p>
          <p className="text-sm mt-1">Click "Fetch Emails" to pull from Gmail.</p>
        </div>
      )}
    </div>
  );
}

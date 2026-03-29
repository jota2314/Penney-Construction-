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
  attachments: { filename: string; mimeType: string; storage_path: string | null }[];
}

export function EmailInbox() {
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

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
      router.refresh();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed");
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleFetchEmails}
        disabled={fetching}
        variant="outline"
        className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
      >
        {fetching
          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          : <Download className="h-4 w-4 mr-2" />}
        {fetching ? "Fetching..." : "Fetch 20 Emails"}
      </Button>
      {result && (
        <p className="text-xs text-muted-foreground">{result}</p>
      )}
    </div>
  );
}

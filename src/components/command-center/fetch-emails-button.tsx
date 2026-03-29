"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "lucide-react";
import { useRouter } from "next/navigation";

export function FetchEmailsButton() {
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  async function handleFetch() {
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
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleFetch} disabled={fetching} variant="outline" size="sm"
        className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10">
        {fetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
        {fetching ? "Fetching..." : "Fetch Emails"}
      </Button>
      {result && <p className="text-[10px] text-muted-foreground">{result}</p>}
    </div>
  );
}

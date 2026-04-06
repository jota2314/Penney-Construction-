"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, X, Check, Search, Mail } from "lucide-react";

interface Sub {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  trades: string[] | null;
}

interface RequestQuotesDialogProps {
  projectId: string;
  projectName: string;
  trade: string;
  lineDescription: string;
  scopeText: string;
  budgetedCost: number;
  onClose: () => void;
  onSent: () => void;
}

export function RequestQuotesDialog({
  projectId, projectName, trade, lineDescription, scopeText, budgetedCost, onClose, onSent,
}: RequestQuotesDialogProps) {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [allSubs, setAllSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showAllSubs, setShowAllSubs] = useState(false);

  const [subject, setSubject] = useState(
    `Quote Request — ${lineDescription} — ${projectName}`
  );
  const [body, setBody] = useState("");

  // Fetch subs by trade
  useEffect(() => {
    const supabase = createClient();

    async function load() {
      // Get subs that match the trade
      const { data: tradeSubs } = await supabase
        .from("subcontractors")
        .select("id, company_name, contact_name, email, phone, trades")
        .eq("is_active", true)
        .order("company_name");

      const all = tradeSubs || [];
      setAllSubs(all);

      // Filter by trade
      const normalizedTrade = trade.toLowerCase();
      const matched = all.filter((s) =>
        s.trades?.some((t: string) => t.toLowerCase().includes(normalizedTrade)) ||
        s.company_name.toLowerCase().includes(normalizedTrade)
      );

      setSubs(matched.length > 0 ? matched : all);
      if (matched.length === 0) setShowAllSubs(true);

      // Build default email body
      setBody(
        `Hi,\n\n` +
        `We're requesting a quote for the following scope of work on the ${projectName} project:\n\n` +
        `Trade: ${trade}\n` +
        `Scope: ${lineDescription}\n` +
        (scopeText ? `\nDetails:\n${scopeText}\n` : "") +
        `\nPlease send your quote at your earliest convenience.\n\n` +
        `Thanks,\nJorge Betancur\nPenney Construction Inc.`
      );

      setLoading(false);
    }
    load();
  }, [trade, projectName, lineDescription, scopeText]);

  function toggleSub(subId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId);
      else next.add(subId);
      return next;
    });
  }

  async function handleSend() {
    const recipients = displayedSubs
      .filter((s) => selected.has(s.id) && s.email)
      .map((s) => ({ id: s.id, name: s.company_name, email: s.email! }));

    if (recipients.length === 0) {
      setResult("Select at least one sub with an email address");
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const res = await fetch("/api/request-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName,
          trade,
          scope: scopeText || lineDescription,
          lineItemId: null,
          subject,
          body,
          recipients,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setResult(`Error: ${data.error}`);
      } else {
        setResult(data.message);
        setTimeout(() => { onSent(); onClose(); }, 1500);
      }
    } catch {
      setResult("Failed to send");
    } finally {
      setSending(false);
    }
  }

  const displayedSubs = (showAllSubs ? allSubs : subs).filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.company_name.toLowerCase().includes(q) ||
      s.contact_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q);
  });

  const fmt = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="text-base font-semibold">Request Quotes</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="text-[10px] capitalize">{trade}</Badge>
              <span className="text-xs text-muted-foreground">{lineDescription}</span>
              <span className="text-xs font-medium">{fmt(budgetedCost)}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Finding {trade} subs...</span>
            </div>
          ) : (
            <>
              {/* Sub Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium">
                    {showAllSubs ? "All Subcontractors" : `${trade} Subcontractors`}
                    <span className="text-muted-foreground ml-1">({displayedSubs.length})</span>
                  </h3>
                  {!showAllSubs && subs.length > 0 && (
                    <button onClick={() => setShowAllSubs(true)} className="text-xs text-amber-400 hover:underline">
                      Show all subs
                    </button>
                  )}
                  {showAllSubs && subs.length > 0 && (
                    <button onClick={() => setShowAllSubs(false)} className="text-xs text-amber-400 hover:underline">
                      Show {trade} only
                    </button>
                  )}
                </div>

                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search subs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>

                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {displayedSubs.map((sub) => (
                    <label
                      key={sub.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        selected.has(sub.id) ? "bg-amber-500/10 border border-amber-500/30" : "hover:bg-muted/30 border border-transparent"
                      } ${!sub.email ? "opacity-40" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(sub.id)}
                        onChange={() => toggleSub(sub.id)}
                        disabled={!sub.email}
                        className="rounded accent-amber-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{sub.company_name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {sub.contact_name && <span>{sub.contact_name} · </span>}
                          {sub.email || "No email"}
                        </div>
                      </div>
                      {sub.email && <Mail className="h-3 w-3 text-muted-foreground shrink-0" />}
                    </label>
                  ))}
                  {displayedSubs.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No subs found</p>
                  )}
                </div>
              </div>

              {/* Email Editor */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Email</h3>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject"
                  className="h-8 text-xs"
                />
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="text-xs leading-relaxed"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t">
          <div className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} sub${selected.size !== 1 ? "s" : ""} selected` : "Select subs to send to"}
          </div>
          {result && (
            <span className={`text-xs ${result.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>
              {result.startsWith("Sent") && <Check className="h-3 w-3 inline mr-1" />}
              {result}
            </span>
          )}
          <Button onClick={handleSend} disabled={sending || selected.size === 0} size="sm" className="bg-amber-600 hover:bg-amber-700">
            {sending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
            {sending ? "Sending..." : `Send to ${selected.size} Sub${selected.size !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

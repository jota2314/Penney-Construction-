"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, UserPlus, Globe, Phone, Mail, Star, RefreshCw, CheckCircle2 } from "lucide-react";
import { createSubcontractor } from "@/lib/actions/subcontractors";

interface FoundSub {
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string;
  state: string;
  trades: string[];
  rating: number;
  notes: string;
}

const TRADES = [
  "Plumbing", "Electrical", "HVAC", "Framing", "Tile",
  "Painting", "Plaster", "Insulation", "Roofing", "Siding",
  "Concrete", "Flooring", "Cabinets", "Countertops", "Excavation",
  "Drywall", "Glass", "Demolition", "Masonry", "Waterproofing",
];

interface SubFinderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTrade?: string;
}

export function SubFinderDialog({ open, onOpenChange, defaultTrade }: SubFinderDialogProps) {
  const router = useRouter();
  const [trade, setTrade] = useState(defaultTrade || "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FoundSub[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(nextPage = 1) {
    if (!trade) return;
    setSearching(true);
    setError(null);

    try {
      const res = await fetch("/api/find-subs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade, page: nextPage }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        if (nextPage === 1) {
          setResults(data.contractors);
        } else {
          setResults((prev) => [...prev, ...data.contractors]);
        }
        setPage(nextPage);
      }
    } catch {
      setError("Search failed");
    }
    setSearching(false);
  }

  async function handleAdd(sub: FoundSub) {
    const result = await createSubcontractor({
      company_name: sub.company_name,
      contact_name: sub.contact_name || undefined,
      phone: sub.phone || undefined,
      email: sub.email || undefined,
      city: sub.city,
      state: sub.state,
      trades: sub.trades,
      vetting_status: "prospect",
      notes: sub.notes + (sub.website ? `\nWebsite: ${sub.website}` : ""),
    });

    if (!result.error) {
      setAddedIds((prev) => new Set([...prev, sub.company_name]));
      router.refresh();
    }
  }

  function handleClose() {
    onOpenChange(false);
    // Don't clear results so they persist if reopened
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-amber-500" />
            Find Subcontractors
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Trade selector + search button */}
          <div className="flex gap-2">
            <Select value={trade} onValueChange={setTrade}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select trade..." />
              </SelectTrigger>
              <SelectContent>
                {TRADES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => handleSearch(1)}
              disabled={!trade || searching}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Search</span>
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {results.length} contractors found for {trade} — North Shore MA
              </div>

              {results.map((sub) => {
                const isAdded = addedIds.has(sub.company_name);

                return (
                  <div key={sub.company_name} className="rounded-lg border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{sub.company_name}</span>
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: sub.rating || 0 }).map((_, i) => (
                              <Star key={i} className="h-3 w-3 fill-amber-500 text-amber-500" />
                            ))}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {sub.city}, {sub.state}
                          {sub.contact_name && ` · ${sub.contact_name}`}
                        </div>
                        <p className="text-xs text-muted-foreground/70 mt-1">{sub.notes}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          {sub.phone && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Phone className="h-3 w-3" /> {sub.phone}
                            </span>
                          )}
                          {sub.email && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Mail className="h-3 w-3" /> {sub.email}
                            </span>
                          )}
                          {sub.website && (
                            <span className="flex items-center gap-1 text-[11px] text-blue-400">
                              <Globe className="h-3 w-3" /> {sub.website}
                            </span>
                          )}
                        </div>
                      </div>

                      <Button
                        variant={isAdded ? "outline" : "default"}
                        size="sm"
                        className="shrink-0 h-8"
                        onClick={() => handleAdd(sub)}
                        disabled={isAdded}
                      >
                        {isAdded ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-green-500" />
                            Added
                          </>
                        ) : (
                          <>
                            <UserPlus className="h-3.5 w-3.5 mr-1" />
                            Add
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* Load more */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleSearch(page + 1)}
                disabled={searching}
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Find More
              </Button>
            </div>
          )}

          {/* Initial state */}
          {results.length === 0 && !searching && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Select a trade and search to find contractors in your area</p>
              <p className="text-xs mt-1">Results from North Shore MA (Beverly, Peabody, Salem, Danvers...)</p>
            </div>
          )}

          {searching && results.length === 0 && (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-amber-500" />
              <p className="text-sm text-muted-foreground">Searching for {trade} contractors...</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

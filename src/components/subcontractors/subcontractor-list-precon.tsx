"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  ChevronDown,
  Check,
  Mail,
} from "lucide-react";
import { SubcontractorFormDialog } from "./subcontractor-form-dialog";
import { SubcontractorDeleteDialog } from "./subcontractor-delete-dialog";
import { VettingStatusBadge } from "./vetting-status-badge";
import { updateVettingStatus } from "@/lib/actions/subcontractors";
import {
  ALL_VETTING_STATUSES,
  VETTING_STATUS_LABELS,
} from "@/lib/constants/subcontractor";
import type { Subcontractor } from "@/types/database";

interface SubcontractorListPreconProps {
  subcontractors: Subcontractor[];
}

function buildBidRequestMailto(sub: Subcontractor) {
  const subject = encodeURIComponent(
    `Bid Request — Penney Construction`
  );
  const trades = sub.trades.length > 0 ? sub.trades.join(", ") : "your trade";
  const body = encodeURIComponent(
    `Hi ${sub.contact_name || sub.company_name},\n\n` +
      `We have an upcoming project and would like to invite ${sub.company_name} to submit a bid for ${trades} work.\n\n` +
      `Please find the scope of work attached. Let us know if you have any questions or need a site visit.\n\n` +
      `Looking forward to your proposal.\n\n` +
      `Best regards,\nPenney Construction`
  );
  return `mailto:${sub.email ?? ""}?subject=${subject}&body=${body}`;
}

export function SubcontractorListPrecon({
  subcontractors,
}: SubcontractorListPreconProps) {
  const [search, setSearch] = useState("");
  const [vettingTab, setVettingTab] = useState<string>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editSub, setEditSub] = useState<Subcontractor | null>(null);
  const [deleteSub, setDeleteSub] = useState<Subcontractor | null>(null);

  const filtered = useMemo(() => {
    let list = subcontractors;

    if (vettingTab !== "all") {
      list = list.filter((s) => s.vetting_status === vettingTab);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.company_name.toLowerCase().includes(q) ||
          s.contact_name?.toLowerCase().includes(q) ||
          s.phone?.toLowerCase().includes(q) ||
          s.trades.some((t) => t.toLowerCase().includes(q))
      );
    }

    return list;
  }, [subcontractors, search, vettingTab]);

  const vettingCounts = useMemo(() => {
    const counts: Record<string, number> = { all: subcontractors.length };
    for (const s of subcontractors) {
      counts[s.vetting_status] = (counts[s.vetting_status] || 0) + 1;
    }
    return counts;
  }, [subcontractors]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search subs by name, trade, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Sub
        </Button>
      </div>

      <Tabs value={vettingTab} onValueChange={setVettingTab}>
        <TabsList>
          <TabsTrigger value="all">
            All ({vettingCounts.all || 0})
          </TabsTrigger>
          <TabsTrigger value="prospect">
            Prospect ({vettingCounts.prospect || 0})
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({vettingCounts.approved || 0})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead className="hidden md:table-cell">Contact</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead className="hidden lg:table-cell">Trades</TableHead>
              <TableHead className="hidden md:table-cell">Vetting</TableHead>
              <TableHead className="w-[140px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  {subcontractors.length === 0
                    ? "No subcontractors yet. Add your first sub to get started."
                    : "No subcontractors match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-medium">
                    {sub.company_name}
                    {sub.contact_name && (
                      <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                        {sub.contact_name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {sub.contact_name ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {sub.phone ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {sub.trades.length > 0
                        ? sub.trades.map((trade) => (
                            <Badge
                              key={trade}
                              variant="secondary"
                              className="text-xs"
                            >
                              {trade}
                            </Badge>
                          ))
                        : "—"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity">
                          <VettingStatusBadge status={sub.vetting_status} />
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {ALL_VETTING_STATUSES.map((s) => (
                          <DropdownMenuItem
                            key={s}
                            onClick={() => updateVettingStatus(sub.id, s)}
                          >
                            {sub.vetting_status === s && (
                              <Check className="mr-2 h-4 w-4" />
                            )}
                            <span
                              className={
                                sub.vetting_status === s
                                  ? "font-medium"
                                  : "ml-6"
                              }
                            >
                              {VETTING_STATUS_LABELS[s]}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {sub.email && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Send bid request email"
                          asChild
                        >
                          <a href={buildBidRequestMailto(sub)}>
                            <Mail className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditSub(sub)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteSub(sub)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <SubcontractorFormDialog open={formOpen} onOpenChange={setFormOpen} />

      {editSub && (
        <SubcontractorFormDialog
          open={!!editSub}
          onOpenChange={(open) => {
            if (!open) setEditSub(null);
          }}
          subcontractor={editSub}
        />
      )}

      {deleteSub && (
        <SubcontractorDeleteDialog
          open={!!deleteSub}
          onOpenChange={(open) => {
            if (!open) setDeleteSub(null);
          }}
          subcontractor={deleteSub}
        />
      )}
    </div>
  );
}

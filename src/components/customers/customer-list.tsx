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
import { Plus, Pencil, Trash2, Search, RefreshCw, Loader2 } from "lucide-react";
import { CustomerFormDialog } from "./customer-form-dialog";
import { CustomerDeleteDialog } from "./customer-delete-dialog";
import type { Customer } from "@/types/database";

interface CustomerListProps {
  customers: Customer[];
}

export function CustomerList({ customers }: CustomerListProps) {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const [qbSyncingId, setQbSyncingId] = useState<string | null>(null);
  const [qbStatus, setQbStatus] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function handleQbSync(customer: Customer) {
    setQbSyncingId(customer.id);
    setQbStatus((s) => ({ ...s, [customer.id]: { ok: true, text: "Syncing…" } }));
    try {
      const res = await fetch("/api/quickbooks/sync-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customer.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setQbStatus((s) => ({ ...s, [customer.id]: { ok: false, text: data.error || "Sync failed" } }));
      } else {
        setQbStatus((s) => ({ ...s, [customer.id]: { ok: true, text: data.message || "Synced to QuickBooks" } }));
      }
    } catch {
      setQbStatus((s) => ({ ...s, [customer.id]: { ok: false, text: "Sync failed — check console" } }));
    } finally {
      setQbSyncingId(null);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.first_name.toLowerCase().includes(q) ||
        c.last_name.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q)
    );
  }, [customers, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Customer
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead className="hidden md:table-cell">Location</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {customers.length === 0
                    ? "No customers yet. Create your first customer to get started."
                    : "No customers match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    {customer.first_name} {customer.last_name}
                    {customer.phone && (
                      <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                        {customer.phone}
                      </div>
                    )}
                    {qbStatus[customer.id] && (
                      <div
                        className={`text-xs mt-0.5 ${
                          qbStatus[customer.id].ok ? "text-green-500" : "text-red-400"
                        }`}
                      >
                        {qbStatus[customer.id].text}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{customer.email ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{customer.phone ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {[customer.city, customer.state]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Sync to QuickBooks"
                        disabled={qbSyncingId === customer.id}
                        onClick={() => handleQbSync(customer)}
                      >
                        {qbSyncingId === customer.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditCustomer(customer)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteCustomer(customer)}
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

      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      {editCustomer && (
        <CustomerFormDialog
          open={!!editCustomer}
          onOpenChange={(open) => {
            if (!open) setEditCustomer(null);
          }}
          customer={editCustomer}
        />
      )}

      {deleteCustomer && (
        <CustomerDeleteDialog
          open={!!deleteCustomer}
          onOpenChange={(open) => {
            if (!open) setDeleteCustomer(null);
          }}
          customer={deleteCustomer}
        />
      )}
    </div>
  );
}

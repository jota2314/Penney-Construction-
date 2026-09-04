"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccount, updateAccount } from "@/lib/actions/books";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPE_ORDER, type Account, type AccountType } from "@/lib/finance/accounts";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

/**
 * The chart of accounts, editable in place. Rename, point at a different
 * QuickBooks account, add a row, retire a row nobody uses. System rows
 * (the ones the app's own rules land on) keep their type and stay active.
 */
export function BooksChart({
  accounts,
  ytdByAccount,
  year,
}: {
  accounts: Account[];
  ytdByAccount: Record<string, { debits: number; credits: number; count: number }>;
  year: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; qbo_name: string }>({ name: "", qbo_name: "" });
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<{ code: string; name: string; type: AccountType; qbo_name: string }>({
    code: "",
    name: "",
    type: "expense",
    qbo_name: "",
  });

  const byType = new Map<AccountType, Account[]>();
  for (const a of accounts) {
    const arr = byType.get(a.type) ?? [];
    arr.push(a);
    byType.set(a.type, arr);
  }

  function startEdit(a: Account) {
    setEditing(a.id);
    setDraft({ name: a.name, qbo_name: a.qbo_name ?? "" });
    setError(null);
  }

  function save(a: Account) {
    startTransition(async () => {
      const res = await updateAccount({ id: a.id, name: draft.name, qbo_name: draft.qbo_name });
      if (res.error) setError(res.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  function toggleActive(a: Account) {
    startTransition(async () => {
      const res = await updateAccount({ id: a.id, is_active: !a.is_active });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function add() {
    startTransition(async () => {
      const res = await createAccount(newRow);
      if (res.error) setError(res.error);
      else {
        setAdding(false);
        setNewRow({ code: "", name: "", type: "expense", qbo_name: "" });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-muted-foreground max-w-xl">
          Every bill and every bank line books to one of these. The QuickBooks column is the account name the push
          uses. Rename freely; the code is what the CPA keys on.
        </p>
        <button
          onClick={() => setAdding((v) => !v)}
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
        >
          {adding ? "Cancel" : "Add account"}
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}

      {adding && (
        <div className="rounded-lg border bg-card p-3 grid gap-2 sm:grid-cols-[90px_1fr_140px_1fr_auto] items-end">
          <label className="text-[11px] text-muted-foreground">
            Code
            <input
              value={newRow.code}
              onChange={(e) => setNewRow({ ...newRow, code: e.target.value })}
              placeholder="6975"
              className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Name
            <input
              value={newRow.name}
              onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
              placeholder="Equipment rental"
              className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Type
            <select
              value={newRow.type}
              onChange={(e) => setNewRow({ ...newRow, type: e.target.value as AccountType })}
              className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {ACCOUNT_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-muted-foreground">
            QuickBooks account
            <input
              value={newRow.qbo_name}
              onChange={(e) => setNewRow({ ...newRow, qbo_name: e.target.value })}
              placeholder="same as name"
              className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={add}
            disabled={pending}
            className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      {ACCOUNT_TYPE_ORDER.map((type) => {
        const rows = byType.get(type) ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={type} className="rounded-lg border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {ACCOUNT_TYPE_LABEL[type]}
            </div>
            <div className="divide-y">
              {rows.map((a) => {
                const ytd = ytdByAccount[a.id];
                const net = ytd ? (type === "income" ? ytd.credits - ytd.debits : ytd.debits - ytd.credits) : 0;
                const isEditing = editing === a.id;
                return (
                  <div key={a.id} className={`px-3 py-2 flex items-center gap-3 ${a.is_active ? "" : "opacity-50"}`}>
                    <span className="w-12 shrink-0 tabular-nums text-[12px] text-muted-foreground">{a.code}</span>
                    {isEditing ? (
                      <div className="flex-1 grid gap-2 sm:grid-cols-2">
                        <input
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          className="rounded-md border bg-background px-2 py-1 text-sm"
                        />
                        <input
                          value={draft.qbo_name}
                          onChange={(e) => setDraft({ ...draft, qbo_name: e.target.value })}
                          placeholder="QuickBooks account"
                          className="rounded-md border bg-background px-2 py-1 text-sm"
                        />
                      </div>
                    ) : (
                      <button onClick={() => startEdit(a)} className="flex-1 min-w-0 text-left">
                        <div className="text-[13px] font-medium truncate">{a.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          QuickBooks: {a.qbo_name ?? "—"}
                          {a.is_system && <span className="ml-2 rounded bg-muted px-1 py-px text-[9.5px] uppercase tracking-wide">system</span>}
                        </div>
                      </button>
                    )}
                    <div className="shrink-0 text-right">
                      <div className="text-[13px] font-semibold tabular-nums">{ytd ? money(net) : "—"}</div>
                      <div className="text-[10.5px] text-muted-foreground tabular-nums">
                        {ytd ? `${ytd.count.toLocaleString()} lines · ${year}` : `no lines ${year}`}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <button onClick={() => save(a)} disabled={pending} className="rounded-md bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white">
                            Save
                          </button>
                          <button onClick={() => setEditing(null)} className="rounded-md border px-2 py-1 text-[11px]">
                            Cancel
                          </button>
                        </>
                      ) : (
                        !a.is_system && (
                          <button
                            onClick={() => toggleActive(a)}
                            disabled={pending}
                            title={a.is_active ? "Retire — hides it from pickers, keeps history" : "Bring back"}
                            className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            {a.is_active ? "Retire" : "Restore"}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

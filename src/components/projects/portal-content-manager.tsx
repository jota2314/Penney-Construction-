"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, FileText, Loader2, Plus, Send, Undo2, Trash2, ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// What the client sees on the portal, and the switch that puts it there.
// Selection sheets and documents are STAGED until someone presses Publish;
// decisions (client_selections) can be hidden per row. "Preview as client"
// shows the whole portal, drafts included, without touching the client's
// view count.

interface SheetRow {
  id: string; title: string; revision: string | null; sheet_date: string | null;
  show_prices: boolean; show_allowances: boolean; published_at: string | null;
  created_at: string; client_selection_items: { count: number }[];
}
interface DocRow { id: string; kind: string; title: string; filename: string | null; published_at: string | null; created_at: string }
interface DecisionRow { id: string; category: string; status: string; client_visible: boolean; client_done_at: string | null; client_dismissed_at: string | null; selected_value: string | null }
interface ClientItemRow { id: string; name: string; client_action: "approved" | "removed"; client_action_at: string | null; client_selection_sheets: { project_id: string } }
interface ClientPhaseRow { id: string; name: string; client_completed_at: string | null }
interface FileRow { id: string; filename: string; storage_bucket: string | null; storage_path: string; created_at: string }

const DOC_KINDS: [string, string][] = [
  ["design", "Design presentation"],
  ["drawing", "Drawings"],
  ["selections", "Selections"],
  ["permit", "Permit"],
  ["other", "Other"],
];

const fmtDay = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

export function PortalContentManager({ projectId, userId }: { projectId: string; userId: string }) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [clientItems, setClientItems] = useState<ClientItemRow[]>([]);
  const [clientPhases, setClientPhases] = useState<ClientPhaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // Two-step confirm (no window.confirm — the browser pane auto-dismisses it).
  const [confirming, setConfirming] = useState<string | null>(null);
  const [addFileId, setAddFileId] = useState("");
  const [addKind, setAddKind] = useState("design");
  const [addTitle, setAddTitle] = useState("");

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [s, d, c, f, ci, cp] = await Promise.all([
      supabase.from("client_selection_sheets")
        .select("id, title, revision, sheet_date, show_prices, show_allowances, published_at, created_at, client_selection_items(count)")
        .eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("client_portal_documents")
        .select("id, kind, title, filename, published_at, created_at")
        .eq("project_id", projectId).order("sort_order").order("created_at", { ascending: false }),
      supabase.from("client_selections")
        .select("id, category, status, client_visible, client_done_at, client_dismissed_at, selected_value")
        .eq("project_id", projectId).order("sort_order"),
      supabase.from("project_files")
        .select("id, filename, storage_bucket, storage_path, created_at")
        .eq("project_id", projectId).ilike("filename", "%.pdf").order("created_at", { ascending: false }),
      // What the client tapped on their portal (approve / remove / mark complete).
      supabase.from("client_selection_items")
        .select("id, name, client_action, client_action_at, client_selection_sheets!inner(project_id)")
        .eq("client_selection_sheets.project_id", projectId).not("client_action", "is", null)
        .order("client_action_at", { ascending: false }),
      supabase.from("schedule_phases")
        .select("id, name, client_completed_at")
        .eq("project_id", projectId).not("client_completed_at", "is", null)
        .order("client_completed_at", { ascending: false }),
    ]);
    return {
      sheets: (s.data as SheetRow[]) ?? [],
      docs: (d.data as DocRow[]) ?? [],
      decisions: (c.data as DecisionRow[]) ?? [],
      files: (f.data as FileRow[]) ?? [],
      clientItems: (ci.data as unknown as ClientItemRow[]) ?? [],
      clientPhases: (cp.data as ClientPhaseRow[]) ?? [],
    };
  }, [projectId]);

  const apply = (r: Awaited<ReturnType<typeof fetchAll>>) => {
    setSheets(r.sheets);
    setDocs(r.docs);
    setDecisions(r.decisions);
    setFiles(r.files);
    setClientItems(r.clientItems);
    setClientPhases(r.clientPhases);
    setLoading(false);
  };
  const load = () => fetchAll().then(apply);

  useEffect(() => {
    let alive = true;
    fetchAll().then((r) => { if (alive) apply(r); });
    return () => { alive = false; };
  }, [fetchAll]);

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    setConfirming(null);
    if (error) alert(error.message);
    await load();
  }

  const now = () => new Date().toISOString();
  const supabase = createClient();

  function publishSheet(row: SheetRow, publish: boolean) {
    return run(row.id, () => supabase.from("client_selection_sheets")
      .update(publish ? { published_at: now(), published_by: userId, updated_at: now() } : { published_at: null, published_by: null, updated_at: now() })
      .eq("id", row.id));
  }
  function toggleSheet(row: SheetRow, field: "show_prices" | "show_allowances") {
    return run(row.id + field, () => supabase.from("client_selection_sheets")
      .update({ [field]: !row[field], updated_at: now() }).eq("id", row.id));
  }
  function publishDoc(row: DocRow, publish: boolean) {
    return run(row.id, () => supabase.from("client_portal_documents")
      .update(publish ? { published_at: now(), published_by: userId, updated_at: now() } : { published_at: null, published_by: null, updated_at: now() })
      .eq("id", row.id));
  }
  function removeDoc(row: DocRow) {
    return run(row.id + "rm", () => supabase.from("client_portal_documents").delete().eq("id", row.id));
  }
  function toggleDecision(row: DecisionRow) {
    return run(row.id, () => supabase.from("client_selections")
      .update({ client_visible: !row.client_visible, updated_at: now() }).eq("id", row.id));
  }
  // Undo a client's tap from the office side (nothing a client does erases data).
  function undoClientItem(row: ClientItemRow) {
    return run(row.id, () => supabase.from("client_selection_items")
      .update({ client_action: null, client_action_at: null, client_action_by: null, updated_at: now() }).eq("id", row.id));
  }
  function undoClientDecision(row: DecisionRow) {
    const patch: Record<string, unknown> = { client_dismissed_at: null, updated_at: now() };
    if (row.client_done_at) {
      patch.client_done_at = null;
      patch.status = "pending";
      if (row.selected_value === "Done") patch.selected_value = null;
    }
    return run(row.id, () => supabase.from("client_selections").update(patch).eq("id", row.id));
  }
  function undoClientPhase(row: ClientPhaseRow) {
    return run(row.id, () => supabase.from("schedule_phases")
      .update({ client_completed_at: null, client_completed_by: null }).eq("id", row.id));
  }

  function addDocument() {
    const f = files.find((x) => x.id === addFileId);
    if (!f) return;
    return run("add", () => supabase.from("client_portal_documents").insert({
      project_id: projectId,
      kind: addKind,
      title: addTitle.trim() || f.filename.replace(/\.pdf$/i, "").replace(/[-_]+/g, " "),
      storage_bucket: f.storage_bucket || "project-files",
      storage_path: f.storage_path,
      filename: f.filename,
      project_file_id: f.id,
      created_by: userId,
    })).then(() => { setAddFileId(""); setAddTitle(""); });
  }

  if (loading) {
    return <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading portal content…</div>;
  }

  const LiveBadge = ({ live }: { live: boolean }) => (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"}`}>
      {live ? "Live" : "Draft"}
    </span>
  );

  const clientDecisions = decisions.filter((d) => d.client_done_at || d.client_dismissed_at);
  const clientChanges = clientItems.length + clientDecisions.length + clientPhases.length;

  return (
    <div className="space-y-4">
      <a href={`/portal-preview/${projectId}`} target="_blank" rel="noreferrer" className="block">
        <Button variant="outline" className="w-full gap-2"><Eye className="h-4 w-4" /> Preview as client (drafts included)</Button>
      </a>

      {/* What the client changed from their phone */}
      {clientChanges > 0 && (
        <section className="rounded-lg border border-amber-500/40 p-3">
          <h4 className="mb-1 text-sm font-semibold">Client changes ({clientChanges})</h4>
          <p className="mb-2 text-xs text-muted-foreground">Taps from the client&apos;s portal. Each one also put a to-do on the list. Undo puts it back the way it was.</p>
          <ul className="divide-y">
            {clientPhases.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-sm">Marked complete: {p.name} <span className="text-xs text-muted-foreground">· {fmtDay(p.client_completed_at)}</span></span>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => undoClientPhase(p)}><Undo2 className="h-3.5 w-3.5" /> Undo</Button>
              </li>
            ))}
            {clientItems.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-sm">{i.client_action === "approved" ? "Approved" : "Removed"}: {i.name} <span className="text-xs text-muted-foreground">· {fmtDay(i.client_action_at)}</span></span>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => undoClientItem(i)}><Undo2 className="h-3.5 w-3.5" /> {i.client_action === "removed" ? "Restore" : "Undo"}</Button>
              </li>
            ))}
            {clientDecisions.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-sm">{d.client_dismissed_at ? "Not needed" : "Marked done"}: {d.category} <span className="text-xs text-muted-foreground">· {fmtDay(d.client_dismissed_at || d.client_done_at)}</span></span>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => undoClientDecision(d)}><Undo2 className="h-3.5 w-3.5" /> {d.client_dismissed_at ? "Restore" : "Undo"}</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Selection sheets */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-amber-500" />
          <h4 className="text-sm font-semibold">Selection sheets</h4>
        </div>
        {sheets.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet. The newest published sheet shows in the client&apos;s Selections tab.</p>
        ) : (
          <ul className="space-y-2">
            {sheets.map((s) => {
              const live = !!s.published_at;
              const key = `sheet-${s.id}`;
              return (
                <li key={s.id} className="rounded-md border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{[s.title, s.revision].filter(Boolean).join(" ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.client_selection_items?.[0]?.count ?? 0} items · {live ? `published ${fmtDay(s.published_at)}` : `staged ${fmtDay(s.created_at)}`}
                      </p>
                    </div>
                    <LiveBadge live={live} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={s.show_prices} disabled={!!busy} onChange={() => toggleSheet(s, "show_prices")} /> Show prices
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={s.show_allowances} disabled={!!busy} onChange={() => toggleSheet(s, "show_allowances")} /> Show allowance check
                    </label>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {confirming === key ? (
                      <>
                        <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => publishSheet(s, !live)}>
                          {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : live ? <Undo2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                          {live ? "Yes, take it off the portal" : "Yes, the client can see it"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant={live ? "outline" : "default"} className="gap-1.5" onClick={() => setConfirming(key)}>
                        {live ? <Undo2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                        {live ? "Unpublish" : "Publish to client"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Documents */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 flex items-center gap-2">
          <FileText className="h-4 w-4 text-amber-500" />
          <h4 className="text-sm font-semibold">Documents</h4>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">Contract, sent change orders and sent invoices appear automatically. Add design presentations or drawings here.</p>
        {docs.length > 0 && (
          <ul className="mb-3 space-y-2">
            {docs.map((d) => {
              const live = !!d.published_at;
              const key = `doc-${d.id}`;
              return (
                <li key={d.id} className="rounded-md border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{DOC_KINDS.find(([k]) => k === d.kind)?.[1] ?? d.kind} · {d.filename}</p>
                    </div>
                    <LiveBadge live={live} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {confirming === key ? (
                      <>
                        <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => publishDoc(d, !live)}>
                          {live ? "Yes, take it off" : "Yes, the client can see it"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant={live ? "outline" : "default"} className="gap-1.5" onClick={() => setConfirming(key)}>
                        {live ? <Undo2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                        {live ? "Unpublish" : "Publish to client"}
                      </Button>
                    )}
                    {!live && (
                      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" disabled={!!busy} onClick={() => removeDoc(d)}>
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
          <select value={addFileId} onChange={(e) => setAddFileId(e.target.value)} className="w-full rounded border bg-background px-2 py-1.5 text-sm">
            <option value="">Add a PDF from this project&apos;s files…</option>
            {files.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
          </select>
          {addFileId && (
            <>
              <div className="flex gap-2">
                <select value={addKind} onChange={(e) => setAddKind(e.target.value)} className="rounded border bg-background px-2 py-1.5 text-sm">
                  {DOC_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="Title the client sees"
                  className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5 text-sm" />
              </div>
              <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={addDocument}>
                <Plus className="h-3.5 w-3.5" /> Add as draft
              </Button>
            </>
          )}
        </div>
      </section>

      {/* Decisions */}
      {decisions.length > 0 && (
        <section className="rounded-lg border p-3">
          <h4 className="mb-1 text-sm font-semibold">Decisions (client choices)</h4>
          <p className="mb-2 text-xs text-muted-foreground">Hide a row when its wording is internal or a selection sheet replaces it.</p>
          <ul className="divide-y">
            {decisions.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className={`truncate text-sm ${d.client_visible ? "" : "text-muted-foreground line-through"}`}>{d.category} <span className="text-xs text-muted-foreground">· {d.status}</span></span>
                <Button size="sm" variant="ghost" className="gap-1.5" disabled={!!busy} onClick={() => toggleDecision(d)}>
                  {d.client_visible ? <><Eye className="h-3.5 w-3.5" /> Visible</> : <><EyeOff className="h-3.5 w-3.5" /> Hidden</>}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

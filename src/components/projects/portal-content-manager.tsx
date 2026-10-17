"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bell, Camera, CheckCircle2, Circle, Eye, EyeOff, FileText, ListChecks, ListTodo, Loader2, Plus, Send, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setLogClientHidden } from "@/lib/actions/portal-photos";
import { SelectionsLogPanel } from "./selections-log-panel";
import { PortalDocumentCover } from "./portal-document-cover";

// What the client sees on the portal, and the switch that puts it there.
// Selection sheets and documents are STAGED until someone presses Publish;
// decisions (client_selections) can be hidden per row. Sub photos are shared
// by default; a sub post's photos can be hidden from the homeowner per post.
// "Preview as client"
// shows the whole portal, drafts included, without touching the client's
// view count. The strip on top says where the portal stands and what to do
// next, so a PM can pick up any job's portal cold.

export interface PortalLinkState { enabled: boolean; link_sent_at: string | null; last_viewed_at: string | null; view_count: number }

interface SheetRow {
  id: string; title: string; revision: string | null; sheet_date: string | null;
  show_prices: boolean; show_allowances: boolean; published_at: string | null;
  created_at: string; client_selection_items: { count: number }[];
}
interface DocRow { id: string; kind: string; title: string; filename: string | null; cover_bucket: string | null; cover_path: string | null; published_at: string | null; created_at: string }
interface DecisionRow { id: string; category: string; status: string; client_visible: boolean; client_done_at: string | null; client_dismissed_at: string | null; selected_value: string | null }
interface ClientItemRow { id: string; name: string; client_action: "approved" | "removed"; client_action_at: string | null; client_selection_sheets: { project_id: string } }
interface ClientPhaseRow { id: string; name: string; client_completed_at: string | null }
interface FileRow { id: string; filename: string; storage_bucket: string | null; storage_path: string; created_at: string }
interface SubPhotoRow { id: string; started_at: string; photo_storage_paths: string[] | null; client_hidden_at: string | null; subcontractors: { company_name: string | null } | null }

const DOC_KINDS: [string, string][] = [
  ["design", "Design presentation"],
  ["drawing", "Drawings"],
  ["selections", "Selections"],
  ["permit", "Permit"],
  ["other", "Other"],
];

const fmtDay = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

export function PortalContentManager({ projectId, userId, portal }: { projectId: string; userId: string; portal: PortalLinkState | null }) {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [imageFiles, setImageFiles] = useState<FileRow[]>([]);
  const [clientItems, setClientItems] = useState<ClientItemRow[]>([]);
  const [clientPhases, setClientPhases] = useState<ClientPhaseRow[]>([]);
  const [subPhotos, setSubPhotos] = useState<SubPhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // Two-step confirm (no window.confirm — the browser pane auto-dismisses it).
  const [confirming, setConfirming] = useState<string | null>(null);
  const [addFileId, setAddFileId] = useState("");
  const [addKind, setAddKind] = useState("design");
  const [addTitle, setAddTitle] = useState("");

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [s, d, c, f, img, ci, cp, sp] = await Promise.all([
      supabase.from("client_selection_sheets")
        .select("id, title, revision, sheet_date, show_prices, show_allowances, published_at, created_at, client_selection_items(count)")
        .eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("client_portal_documents")
        .select("id, kind, title, filename, cover_bucket, cover_path, published_at, created_at")
        .eq("project_id", projectId).order("sort_order").order("created_at", { ascending: false }),
      supabase.from("client_selections")
        .select("id, category, status, client_visible, client_done_at, client_dismissed_at, selected_value")
        .eq("project_id", projectId).order("sort_order"),
      supabase.from("project_files")
        .select("id, filename, storage_bucket, storage_path, created_at")
        .eq("project_id", projectId).ilike("filename", "%.pdf").order("created_at", { ascending: false }),
      // Pictures a design document's Home cover can be made from.
      supabase.from("project_files")
        .select("id, filename, storage_bucket, storage_path, created_at")
        .eq("project_id", projectId)
        .or("filename.ilike.%.jpg,filename.ilike.%.jpeg,filename.ilike.%.png,filename.ilike.%.webp")
        .order("created_at", { ascending: false }),
      // What the client tapped on their portal (approve / remove / mark complete).
      supabase.from("client_selection_items")
        .select("id, name, client_action, client_action_at, client_selection_sheets!inner(project_id)")
        .eq("client_selection_sheets.project_id", projectId).not("client_action", "is", null)
        .order("client_action_at", { ascending: false }),
      supabase.from("schedule_phases")
        .select("id, name, client_completed_at")
        .eq("project_id", projectId).not("client_completed_at", "is", null)
        .order("client_completed_at", { ascending: false }),
      // Sub posts with photos: those photos are on the homeowner's Photos tab
      // unless the office hid them.
      supabase.from("daily_logs")
        .select("id, started_at, photo_storage_paths, client_hidden_at, subcontractors(company_name)")
        .eq("project_id", projectId).not("subcontractor_id", "is", null).not("photo_storage_paths", "eq", "{}")
        .order("started_at", { ascending: false }).limit(100),
    ]);
    return {
      sheets: (s.data as SheetRow[]) ?? [],
      docs: (d.data as DocRow[]) ?? [],
      decisions: (c.data as DecisionRow[]) ?? [],
      files: (f.data as FileRow[]) ?? [],
      imageFiles: (img.data as FileRow[]) ?? [],
      clientItems: (ci.data as unknown as ClientItemRow[]) ?? [],
      clientPhases: (cp.data as ClientPhaseRow[]) ?? [],
      subPhotos: ((sp.data as unknown as SubPhotoRow[]) ?? []).filter((l) => (l.photo_storage_paths?.length ?? 0) > 0),
    };
  }, [projectId]);

  const apply = (r: Awaited<ReturnType<typeof fetchAll>>) => {
    setSheets(r.sheets);
    setDocs(r.docs);
    setDecisions(r.decisions);
    setFiles(r.files);
    setImageFiles(r.imageFiles);
    setClientItems(r.clientItems);
    setClientPhases(r.clientPhases);
    setSubPhotos(r.subPhotos);
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
  // One tap, no confirm: Show puts the photos straight back.
  function toggleSubPhotos(row: SubPhotoRow) {
    return run(`subphotos-${row.id}`, async () => {
      const r = await setLogClientHidden(row.id, !row.client_hidden_at);
      return { error: r.error ? { message: r.error } : null };
    });
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
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"}`}>
      {live ? "Live" : "Draft"}
    </span>
  );

  const clientDecisions = decisions.filter((d) => d.client_done_at || d.client_dismissed_at);
  const clientChanges = clientItems.length + clientDecisions.length + clientPhases.length;
  const subPhotosHidden = subPhotos.filter((l) => l.client_hidden_at).length;

  // Same pick as the portal loader: the client's Home opens on the first
  // published design/drawing document that has a picture.
  const designDocs = docs.filter((d) => d.kind === "design" || d.kind === "drawing");
  const homeCoverId = designDocs.find((d) => d.published_at && d.cover_path)?.id ?? null;
  const coverNote = (d: DocRow) =>
    !d.published_at ? "The client sees it once this document is published."
      : d.id === homeCoverId ? "On the client's Home now."
      : "Another published document's picture shows first.";

  // Where the portal stands, in the order a PM gets a client going.
  const liveDesign = designDocs.filter((d) => d.published_at);
  const liveSheet = sheets.find((s) => s.published_at);
  const draftSheet = sheets.find((s) => !s.published_at);
  const sheetName = (s: SheetRow) => s.revision || s.title;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const steps = [
    { label: "Portal link", done: !!portal?.enabled, detail: !portal ? "Not created" : portal.enabled ? "Created" : "Turned off" },
    { label: "Design & drawings", done: liveDesign.length > 0,
      detail: liveDesign.length ? `${plural(liveDesign.length, "document")} live` : designDocs.length ? `${plural(designDocs.length, "draft")} to publish` : "None added" },
    { label: "Home picture", done: !!homeCoverId,
      detail: homeCoverId ? "Showing on Home" : designDocs.some((d) => d.cover_path) ? "Set on a draft" : "Not set" },
    { label: "Selections", done: !!liveSheet,
      detail: liveSheet ? `${sheetName(liveSheet)} live` : draftSheet ? `${sheetName(draftSheet)} to publish` : "No sheet yet" },
    { label: "Link sent", done: !!portal?.link_sent_at, detail: portal?.link_sent_at ? fmtDay(portal.link_sent_at) : "Not yet" },
    { label: "Client opened it", done: !!portal?.last_viewed_at,
      detail: portal?.last_viewed_at ? `${fmtDay(portal.last_viewed_at)} · ${plural(portal.view_count || 0, "view")}` : "Not yet" },
  ];
  const nextStep = steps.findIndex((s) => !s.done);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4">
        <h4 className="mb-3 text-sm font-semibold">Where this portal stands</h4>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {steps.map((s, i) => (
            <li key={s.label} className={`rounded-lg border p-2.5 ${i === nextStep ? "border-amber-500/60 bg-amber-500/5" : ""}`}>
              <div className="flex items-start gap-1.5">
                {s.done
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  : <Circle className={`h-4 w-4 shrink-0 ${i === nextStep ? "text-amber-500" : "text-muted-foreground/40"}`} />}
                <span className="text-xs font-semibold leading-4">{s.label}</span>
                {i === nextStep && <span className="ml-auto shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-bold uppercase text-amber-500">Next</span>}
              </div>
              <p className="mt-1 pl-[22px] text-xs leading-snug text-muted-foreground">{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* What the client changed from their phone */}
      {clientChanges > 0 && (
        <section className="rounded-xl border border-amber-500/50 bg-amber-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-500" />
            <h4 className="text-sm font-semibold">The client changed something ({clientChanges})</h4>
          </div>
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

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          {/* Documents */}
          <Section icon={FileText} title="Documents" count={docs.length}
            hint="Contract, sent change orders and sent invoices show up on their own. Add design presentations and drawings here.">
            {docs.length > 0 ? (
              <ul className="mb-3 space-y-2">
                {docs.map((d) => {
                  const live = !!d.published_at;
                  const key = `doc-${d.id}`;
                  return (
                    <li key={d.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{d.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{DOC_KINDS.find(([k]) => k === d.kind)?.[1] ?? d.kind} · {live ? `published ${fmtDay(d.published_at)}` : "only staff can see it"}</p>
                        </div>
                        <LiveBadge live={live} />
                      </div>
                      {(d.kind === "design" || d.kind === "drawing") && (
                        <PortalDocumentCover
                          projectId={projectId}
                          doc={{ id: d.id, live, cover_bucket: d.cover_bucket, cover_path: d.cover_path }}
                          imageFiles={imageFiles}
                          note={coverNote(d)}
                          disabled={!!busy}
                          onChanged={load}
                        />
                      )}
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
            ) : (
              <p className="mb-3 text-xs text-muted-foreground">No documents added yet.</p>
            )}
            <div className="space-y-2 rounded-lg bg-muted/40 p-2.5">
              <select value={addFileId} onChange={(e) => setAddFileId(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
                <option value="">{files.length ? "Add a PDF from this project's files…" : "No PDFs in this project's files yet"}</option>
                {files.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
              </select>
              {addFileId && (
                <>
                  <div className="flex gap-2">
                    <select value={addKind} onChange={(e) => setAddKind(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm">
                      {DOC_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                    <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="Title the client sees"
                      className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm" />
                  </div>
                  <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={addDocument}>
                    <Plus className="h-3.5 w-3.5" /> Add as draft
                  </Button>
                </>
              )}
            </div>
          </Section>

          {/* Selection sheets */}
          <Section icon={ListChecks} title="Selection sheets" count={sheets.length}
            hint="The newest published sheet is what the client sees in Selections. Draft a new revision from the Selections log.">
            {sheets.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sheets yet.</p>
            ) : (
              <ul className="space-y-2">
                {sheets.map((s) => {
                  const live = !!s.published_at;
                  const key = `sheet-${s.id}`;
                  return (
                    <li key={s.id} className="rounded-lg border p-3">
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
          </Section>
        </div>

        <div className="space-y-4">
          <SelectionsLogPanel projectId={projectId} onDrafted={load} />

          {/* Decisions */}
          {decisions.length > 0 && (
            <Section icon={ListTodo} title="Decisions" count={decisions.length}
              hint="Choices the client sees in Selections. Hide a row when its wording is internal or a sheet replaces it.">
              <ul className="divide-y">
                {decisions.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className={`min-w-0 truncate text-sm ${d.client_visible ? "" : "text-muted-foreground line-through"}`}>{d.category} <span className="text-xs text-muted-foreground">· {d.status}</span></span>
                    <Button size="sm" variant="ghost" className={`gap-1.5 ${d.client_visible ? "" : "text-muted-foreground"}`} disabled={!!busy} onClick={() => toggleDecision(d)}>
                      {d.client_visible ? <><Eye className="h-3.5 w-3.5" /> Shown</> : <><EyeOff className="h-3.5 w-3.5" /> Hidden</>}
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Sub photos: shared with the homeowner by default, hidden per post */}
          {subPhotos.length > 0 && (
            <Section icon={Camera} title="Sub photos on the homeowner's page" count={subPhotos.length}
              hint={`Photos a sub posts show on the homeowner's Photos tab. Only the photos, never the note or the company. Hide a post that shouldn't be there.${subPhotosHidden > 0 ? ` ${subPhotosHidden} hidden.` : ""}`}>
              <ul className="divide-y">
                {subPhotos.map((l) => {
                  const hidden = !!l.client_hidden_at;
                  const count = l.photo_storage_paths?.length ?? 0;
                  return (
                    <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate text-sm">
                        <span className={hidden ? "text-muted-foreground line-through" : ""}>{l.subcontractors?.company_name || "Sub"}</span>{" "}
                        <span className="text-xs text-muted-foreground">· {fmtDay(l.started_at)} · {count} {count === 1 ? "photo" : "photos"}{hidden ? " · hidden" : ""}</span>
                      </span>
                      <Button size="sm" variant="ghost" className={`shrink-0 gap-1.5 ${hidden ? "text-muted-foreground" : ""}`} disabled={!!busy} onClick={() => toggleSubPhotos(l)}>
                        {busy === `subphotos-${l.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {hidden ? "Hidden" : "Shown"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, count, hint, children }: {
  icon: LucideIcon; title: string; count?: number; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-amber-500" />
          <h4 className="text-sm font-semibold">{title}</h4>
          {!!count && <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">{count}</span>}
        </div>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

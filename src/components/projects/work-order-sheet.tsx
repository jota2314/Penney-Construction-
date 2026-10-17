"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileSignature, Loader2, Plus } from "lucide-react";
import { formatMoney, roundCents } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  draftQuickWorkOrder,
  draftSubChangeOrder,
  draftWorkOrder,
  getAgreementEditor,
  getProjectAgreements,
  markSubAgreementSignedOnPaper,
  preparePaperScanUpload,
  signAndSendSubAgreement,
  updateDraftAgreement,
  voidSubAgreement,
  type AgreementEditorData,
  type OfficeAgreementRow,
  type ProjectAgreementsData,
} from "@/lib/actions/sub-agreements";
import type { SubAgreementDraw, SubAgreementSection, SubPriceBasis } from "@/lib/sub-portal/payload";
import { AGREEMENT_KIND_LABEL, AGREEMENT_STATUS_LABEL, PRICE_BASIS_LABEL } from "@/lib/subs/agreement-format";

/**
 * Work orders on a job (plan §5): the list on the project Subs tab, the
 * "Draft work order" / "Quick work order" starts, and the editor.
 *
 * The office checks every auto-filled field (his quote's scope word for
 * word, the summed price, his dates, the owner's terms); Ryan alone signs
 * for Penney and sends. Send stays locked until Ryan has approved the
 * agreement text on Subcontractors → Agreements. Nothing here emails anyone:
 * a sent agreement shows up in the sub's portal.
 */

const money = (v: number | null | undefined) => formatMoney(v, { cents: "always" });

/** The sub-documents bucket's limit; the scan goes straight to storage, never through the server. */
const PAPER_MAX_BYTES = 20 * 1024 * 1024;

/** What a dropped connection or a refused request says (a server action throws on those). */
const unreachable = (e: unknown) => (e instanceof Error && e.message ? e.message : "Couldn't reach the server. Try again.");

const STATUS_TONE: Record<string, string> = {
  draft: "text-muted-foreground",
  sent: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  viewed: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  signed: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  void: "bg-red-500/15 text-red-400 border-red-500/30",
  superseded: "text-muted-foreground",
};

export interface WorkOrderSubOption {
  id: string;
  company_name: string;
  contact_name: string | null;
}

// ───────────────────────────────────────── the job's list

export function ProjectWorkOrders({
  projectId,
  subDirectory,
  requestDraft,
}: {
  projectId: string;
  subDirectory: WorkOrderSubOption[];
  /** Set by the Subs tab (e.g. right after an award) to draft a work order for that sub. */
  requestDraft?: { subId: string; key: number } | null;
}) {
  const [data, setData] = useState<ProjectAgreementsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // Bumped after any change; the effect below re-reads the list.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const handledKey = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    void getProjectAgreements(projectId).then((res) => {
      if (!live) return;
      if (res.error !== null) setError(res.error);
      else {
        setError(null);
        setData(res.data);
      }
    });
    return () => {
      live = false;
    };
  }, [projectId, version]);

  useEffect(() => {
    if (!requestDraft || handledKey.current === requestDraft.key) return;
    handledKey.current = requestDraft.key;
    void draftWorkOrder({ projectId, subId: requestDraft.subId }).then((res) => {
      if (res.error !== null) setError(res.error);
      else {
        reload();
        setOpenId(res.data.id);
      }
    });
  }, [requestDraft, projectId, reload]);

  const rows = data?.agreements ?? [];
  const workOrders = rows.filter((r) => r.kind === "work_order");
  const changesByParent = new Map<string, OfficeAgreementRow[]>();
  for (const r of rows) {
    if (r.kind !== "change_order" || !r.parent_id) continue;
    changesByParent.set(r.parent_id, [...(changesByParent.get(r.parent_id) ?? []), r]);
  }

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileSignature className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-bold">Work orders</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setNewOpen(true)}>
          <Plus className="h-3 w-3 mr-1" /> Work order
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {data && workOrders.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No work orders on this job yet. Draft one from an awarded quote, or a quick time-and-material one for work nobody quoted.
        </p>
      )}
      <div className="space-y-1.5">
        {workOrders.map((wo) => (
          <div key={wo.id} className="space-y-1">
            <AgreementRowButton row={wo} onOpen={() => setOpenId(wo.id)} />
            {(changesByParent.get(wo.id) ?? []).map((sco) => (
              <div key={sco.id} className="pl-5">
                <AgreementRowButton row={sco} onOpen={() => setOpenId(sco.id)} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {newOpen && data && (
        <NewWorkOrderDialog
          projectId={projectId}
          subDirectory={subDirectory}
          onJobSubIds={data.onJobSubIds}
          portalSubIds={data.portalSubIds}
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            reload();
            setOpenId(id);
          }}
        />
      )}

      {openId && (
        <WorkOrderSheet
          key={openId}
          agreementId={openId}
          onClose={() => setOpenId(null)}
          onChanged={reload}
          onOpenOther={(id) => setOpenId(id)}
        />
      )}
    </div>
  );
}

function AgreementRowButton({ row, onOpen }: { row: OfficeAgreementRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left hover:bg-muted/40 min-w-0"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {row.number} · {row.sub_name}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {row.kind === "change_order" ? "Sub change order" : row.price_basis ? PRICE_BASIS_LABEL[row.price_basis] : "Work order"}
          {row.scope_text ? ` · ${row.scope_text.split("\n")[0]}` : ""}
        </div>
      </div>
      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 shrink-0 ${STATUS_TONE[row.status] ?? ""}`}>
        {row.signed_on_paper && row.status === "signed" ? "Signed on paper" : AGREEMENT_STATUS_LABEL[row.status] ?? row.status}
      </Badge>
      <span className="text-sm font-bold tabular-nums shrink-0">{row.amount != null ? money(row.amount) : "—"}</span>
    </button>
  );
}

// ───────────────────────────────────────── starting one

function NewWorkOrderDialog({
  projectId,
  subDirectory,
  onJobSubIds,
  portalSubIds,
  onClose,
  onCreated,
}: {
  projectId: string;
  subDirectory: WorkOrderSubOption[];
  onJobSubIds: string[];
  portalSubIds: string[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [mode, setMode] = useState<"quote" | "quick">("quote");
  const [subId, setSubId] = useState("");
  const [search, setSearch] = useState("");
  const [rate, setRate] = useState<number | null>(null);
  const [unitLabel, setUnitLabel] = useState("hour");
  const [nte, setNte] = useState<number | null>(null);
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onJob = new Set(onJobSubIds);
  const withPortal = new Set(portalSubIds);
  const q = search.trim().toLowerCase();
  const options = subDirectory
    .filter((s) => !q || s.company_name.toLowerCase().includes(q) || (s.contact_name ?? "").toLowerCase().includes(q))
    .sort((a, b) => Number(onJob.has(b.id)) - Number(onJob.has(a.id)) || a.company_name.localeCompare(b.company_name))
    .slice(0, 40);

  async function create() {
    if (!subId) {
      setError("Pick the sub");
      return;
    }
    setBusy(true);
    setError(null);
    const res =
      mode === "quote"
        ? await draftWorkOrder({ projectId, subId })
        : await draftQuickWorkOrder({ projectId, subId, rate, unitLabel, notToExceed: nte, scope });
    setBusy(false);
    if (res.error !== null) setError(res.error);
    else onCreated(res.data.id);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md flex flex-col min-w-0 max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New work order</DialogTitle>
          <DialogDescription>
            Ryan signs it for Penney and sends it to the sub&apos;s portal. Nothing goes out until then.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={mode === "quote" ? "default" : "outline"} size="sm" onClick={() => setMode("quote")}>
            From his quote
          </Button>
          <Button type="button" variant={mode === "quick" ? "default" : "outline"} size="sm" onClick={() => setMode("quick")}>
            Quick (time and material)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === "quote"
            ? "Fills the scope from his accepted quotes word for word, adds up their price, and takes his dates on this job. You check it before Ryan signs."
            : "For work nobody quoted: an hourly rate, a not-to-exceed and a short scope. Paid only for days he logs in the portal."}
        </p>

        <div className="space-y-1.5 min-w-0">
          <label className="text-[10px] text-muted-foreground font-medium uppercase">Sub</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subs" className="h-8 text-sm" />
          <div className="max-h-48 overflow-y-auto rounded-lg border divide-y">
            {options.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubId(s.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm min-w-0 ${subId === s.id ? "bg-amber-500/10" : "hover:bg-muted/40"}`}
              >
                <span className="flex-1 min-w-0 truncate">
                  {s.company_name}
                  {s.contact_name ? <span className="text-muted-foreground"> · {s.contact_name}</span> : null}
                </span>
                {onJob.has(s.id) && <span className="text-[10px] text-emerald-500 shrink-0">on this job</span>}
                {!withPortal.has(s.id) && <span className="text-[10px] text-muted-foreground shrink-0">no portal login</span>}
              </button>
            ))}
            {options.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No sub matches.</p>}
          </div>
        </div>

        {mode === "quick" && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="text-[10px] text-muted-foreground font-medium uppercase">Rate ($)</label>
                <DecimalInput value={rate} onValueChange={setRate} placeholder="65.00" className="h-8 w-full rounded-md border bg-transparent px-2 text-sm" />
              </div>
              <div className="col-span-1">
                <label className="text-[10px] text-muted-foreground font-medium uppercase">Per</label>
                <Input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="col-span-1">
                <label className="text-[10px] text-muted-foreground font-medium uppercase">Not to exceed ($)</label>
                <DecimalInput value={nte} onValueChange={setNte} placeholder="4,000.00" className="h-8 w-full rounded-md border bg-transparent px-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium uppercase">Scope</label>
              <Textarea value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Demo per Ryan" className="text-sm min-h-[60px]" />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={busy || !subId} className="bg-amber-600 hover:bg-amber-700 text-white">
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Draft it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────── the editor

interface DraftState {
  scope_text: string;
  exclusions_text: string;
  price_basis: SubPriceBasis | null;
  price: number | null;
  unit_rate: number | null;
  unit_label: string;
  not_to_exceed: number | null;
  draws: SubAgreementDraw[];
  start_date: string;
  end_date: string;
  terms: (SubAgreementSection & { checked: boolean })[];
}

function toDraftState(d: AgreementEditorData): DraftState {
  const a = d.agreement;
  return {
    scope_text: a.scope_text ?? "",
    exclusions_text: a.exclusions_text ?? "",
    price_basis: a.price_basis,
    price: a.price,
    unit_rate: a.unit_rate,
    unit_label: a.unit_label ?? "",
    not_to_exceed: a.not_to_exceed,
    draws: a.draws,
    start_date: a.start_date ?? "",
    end_date: a.end_date ?? "",
    terms: d.flow_down_options,
  };
}

export function WorkOrderSheet({
  agreementId,
  onClose,
  onChanged,
  onOpenOther,
}: {
  agreementId: string;
  onClose: () => void;
  onChanged?: () => void;
  /** Open another agreement in place (a new sub change order). */
  onOpenOther?: (id: string) => void;
}) {
  const [data, setData] = useState<AgreementEditorData | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [paperOpen, setPaperOpen] = useState(false);
  const [paperName, setPaperName] = useState("");
  const [paperDate, setPaperDate] = useState("");
  const paperFile = useRef<HTMLInputElement>(null);
  const [scoOpen, setScoOpen] = useState(false);
  const [scoScope, setScoScope] = useState("");
  const [scoAmount, setScoAmount] = useState<number | null>(null);

  // Bumped after a save or action; the effect re-reads the agreement. The
  // parent keys this sheet by agreement id, so another one starts fresh.
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    let live = true;
    void getAgreementEditor(agreementId).then((res) => {
      if (!live) return;
      if (res.error !== null) {
        setError(res.error);
        return;
      }
      setData(res.data);
      setDraft(toDraftState(res.data));
      setDirty(false);
    });
    return () => {
      live = false;
    };
  }, [agreementId, version]);

  const patch = (p: Partial<DraftState>) => {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
    setDirty(true);
    setConfirmSend(false);
  };

  const a = data?.agreement;
  const editable = a?.status === "draft";
  const drawsTotal = draft ? roundCents(draft.draws.reduce((s, d) => s + (d.amount ?? 0), 0)) : 0;
  const committed = draft?.price_basis === "time_and_material" ? draft.not_to_exceed : draft?.price ?? null;

  // Every action clears `busy` in finally: the dialog won't close while it's
  // set, so a dropped connection must never leave it stuck.
  async function save(): Promise<boolean> {
    if (!draft || !a) return false;
    setBusy("save");
    setError(null);
    try {
      const res = await updateDraftAgreement(a.id, {
        scope_text: draft.scope_text,
        exclusions_text: draft.exclusions_text,
        price_basis: draft.price_basis,
        price: draft.price_basis === "time_and_material" ? null : draft.price,
        unit_rate: draft.price_basis === "lump_sum" ? null : draft.unit_rate,
        unit_label: draft.price_basis === "lump_sum" ? null : draft.unit_label,
        not_to_exceed: draft.price_basis === "time_and_material" ? draft.not_to_exceed : null,
        draws: draft.draws,
        start_date: draft.start_date || null,
        end_date: draft.end_date || null,
        additional_terms: draft.terms.filter((t) => t.checked).map(({ title, body }) => ({ title, body })),
      });
      if (res.error !== null) {
        setError(res.error);
        return false;
      }
      setMessage(res.data.penneySignatureCleared ? "Saved. Ryan's signature came off; he signs the new wording." : "Saved.");
      refresh();
      onChanged?.();
      return true;
    } catch (e) {
      setError(unreachable(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function signAndSend() {
    if (!a) return;
    if (dirty && !(await save())) return;
    setBusy("send");
    setError(null);
    try {
      const res = await signAndSendSubAgreement(a.id);
      setConfirmSend(false);
      if (res.error !== null) {
        setError(res.error);
        refresh();
        return;
      }
      setMessage(
        `Signed and sent ${res.data.number}${res.data.alsoSent.length ? ` with master agreement ${res.data.alsoSent.join(", ")}` : ""}. It's in ${data?.sub.company_name}'s portal now.`,
      );
      refresh();
      onChanged?.();
    } catch (e) {
      setConfirmSend(false);
      setError(unreachable(e));
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function doVoid() {
    if (!a) return;
    setBusy("void");
    setError(null);
    try {
      const res = await voidSubAgreement(a.id, voidReason);
      if (res.error !== null) {
        setError(res.error);
        return;
      }
      setVoidOpen(false);
      setMessage(`${res.data.number} is void.${res.data.contractAmount != null ? ` His contract on this job is now ${money(res.data.contractAmount)}.` : ""}`);
      refresh();
      onChanged?.();
    } catch (e) {
      setError(unreachable(e));
    } finally {
      setBusy(null);
    }
  }

  async function filePaper() {
    if (!a) return;
    const file = paperFile.current?.files?.[0];
    if (!file) {
      setError("Add the scan of the signed copy");
      return;
    }
    if (file.size > PAPER_MAX_BYTES) {
      setError("The scan is over 20 MB. Scan it at a lower resolution, or as a PDF.");
      return;
    }
    if (dirty && !(await save())) return;
    setBusy("paper");
    setError(null);
    try {
      // The scan goes straight to storage with a signed upload link (a server
      // action can't take a body over Vercel's 4.5 MB cap); then it's filed.
      const prepared = await preparePaperScanUpload(a.id, file.type, file.size);
      if (prepared.error !== null) {
        setError(prepared.error);
        return;
      }
      const { error: uploadError } = await createClient()
        .storage.from("sub-documents")
        .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: file.type });
      if (uploadError) {
        setError(`The scan didn't upload: ${uploadError.message}. Try again.`);
        return;
      }
      const res = await markSubAgreementSignedOnPaper({ id: a.id, signerName: paperName, signedOn: paperDate || null, ext: prepared.data.ext });
      if (res.error !== null) {
        setError(res.error);
        return;
      }
      setPaperOpen(false);
      setMessage(`${res.data.number} is filed as signed on paper and locked${res.data.contractAmount != null ? ` at ${money(res.data.contractAmount)}` : ""}.`);
      refresh();
      onChanged?.();
    } catch (e) {
      setError(unreachable(e));
    } finally {
      setBusy(null);
    }
  }

  async function newChangeOrder() {
    if (!a) return;
    setBusy("sco");
    setError(null);
    try {
      const res = await draftSubChangeOrder({ parentId: a.id, scope: scoScope, price: scoAmount });
      if (res.error !== null) {
        setError(res.error);
        return;
      }
      setScoOpen(false);
      setScoScope("");
      setScoAmount(null);
      onChanged?.();
      onOpenOther?.(res.data.id);
    } catch (e) {
      setError(unreachable(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="sm:max-w-2xl flex flex-col min-w-0 max-h-[92dvh] overflow-y-auto"
        // The paper-scan file picker coming back must not close the dialog.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {a ? `${AGREEMENT_KIND_LABEL[a.kind]} ${a.number}` : "Work order"}
            {a && (
              <Badge variant="outline" className={`text-[10px] ${STATUS_TONE[a.status] ?? ""}`}>
                {a.signed_on_paper && a.status === "signed" ? "Signed on paper" : AGREEMENT_STATUS_LABEL[a.status] ?? a.status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {data ? `${data.sub.company_name}${data.sub.contact_name ? ` (${data.sub.contact_name})` : ""}${data.project ? ` · ${data.project.name}` : ""}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {error && <p className="text-sm text-red-400 whitespace-pre-wrap">{error}</p>}
        {message && <p className="text-sm text-emerald-500">{message}</p>}

        {data && a && draft && (
          <div className="space-y-4 min-w-0">
            {data.parent && <p className="text-xs text-muted-foreground">Changes work order {data.parent.number}.</p>}
            {editable && data.sources.length > 0 && (
              <ul className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                {data.sources.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}

            <Field label={a.kind === "change_order" ? "What changes" : "Scope (this is what he signs)"}>
              <Textarea value={draft.scope_text} disabled={!editable} onChange={(e) => patch({ scope_text: e.target.value })} className="text-sm min-h-[110px]" />
            </Field>
            <Field label="Not included">
              <Textarea
                value={draft.exclusions_text}
                disabled={!editable}
                onChange={(e) => patch({ exclusions_text: e.target.value })}
                placeholder="Only what his quote excludes, or leave blank"
                className="text-sm min-h-[60px]"
              />
            </Field>

            {a.kind !== "master" && (
              <div className="space-y-2">
                <span className="text-[10px] text-muted-foreground font-medium uppercase">Price</span>
                {a.kind === "work_order" && (
                  <div className="flex gap-1.5 flex-wrap">
                    {(["lump_sum", "unit", "time_and_material"] as SubPriceBasis[]).map((basis) => (
                      <Button
                        key={basis}
                        type="button"
                        size="sm"
                        variant={draft.price_basis === basis ? "default" : "outline"}
                        className="h-7 text-xs"
                        disabled={!editable}
                        onClick={() => patch({ price_basis: basis, unit_label: basis === "time_and_material" && !draft.unit_label ? "hour" : draft.unit_label })}
                      >
                        {PRICE_BASIS_LABEL[basis]}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {draft.price_basis !== "time_and_material" && (
                    <Money
                      label={a.kind === "change_order" ? "Amount (negative = credit)" : draft.price_basis === "unit" ? "Estimated total" : "Price"}
                      value={draft.price}
                      disabled={!editable}
                      onChange={(v) => patch({ price: v })}
                    />
                  )}
                  {draft.price_basis && draft.price_basis !== "lump_sum" && (
                    <>
                      <Money
                        label={draft.price_basis === "unit" ? "Unit price" : "Rate"}
                        value={draft.unit_rate}
                        disabled={!editable}
                        onChange={(v) => patch({ unit_rate: v })}
                      />
                      <Field label="Per">
                        <Input value={draft.unit_label} disabled={!editable} onChange={(e) => patch({ unit_label: e.target.value })} placeholder={draft.price_basis === "unit" ? "sq ft" : "hour"} className="h-8 text-sm" />
                      </Field>
                    </>
                  )}
                  {draft.price_basis === "time_and_material" && (
                    <Money label="Not to exceed" value={draft.not_to_exceed} disabled={!editable} onChange={(v) => patch({ not_to_exceed: v })} />
                  )}
                </div>
              </div>
            )}

            {a.kind === "work_order" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground font-medium uppercase">Payments</span>
                  {editable && (
                    <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => patch({ draws: [...draft.draws, { label: "", amount: null, percent: null, when: null }] })}>
                      <Plus className="h-3 w-3 mr-1" /> Payment
                    </Button>
                  )}
                </div>
                {draft.draws.map((d, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                    <Input
                      className="col-span-4 h-8 text-sm"
                      value={d.label}
                      disabled={!editable}
                      placeholder="On completion"
                      onChange={(e) => patch({ draws: draft.draws.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                    />
                    <Input
                      className="col-span-4 h-8 text-sm"
                      value={d.when ?? ""}
                      disabled={!editable}
                      placeholder="When"
                      onChange={(e) => patch({ draws: draft.draws.map((x, j) => (j === i ? { ...x, when: e.target.value || null } : x)) })}
                    />
                    <DecimalInput
                      className="col-span-3 h-8 rounded-md border bg-transparent px-2 text-sm"
                      value={d.amount}
                      disabled={!editable}
                      placeholder="$"
                      onValueChange={(v) => patch({ draws: draft.draws.map((x, j) => (j === i ? { ...x, amount: v, percent: null } : x)) })}
                    />
                    {editable && (
                      <button type="button" className="col-span-1 text-xs text-muted-foreground hover:text-red-400" onClick={() => patch({ draws: draft.draws.filter((_, j) => j !== i) })}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {committed != null && draft.draws.some((d) => d.amount != null) && drawsTotal !== committed && (
                  <p className="text-xs text-amber-500">
                    Payments add up to {money(drawsTotal)}; the {draft.price_basis === "time_and_material" ? "not-to-exceed" : "price"} is {money(committed)}.
                  </p>
                )}
              </div>
            )}

            {a.kind === "work_order" && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start">
                  <Input type="date" value={draft.start_date} disabled={!editable} onChange={(e) => patch({ start_date: e.target.value })} className="h-8 text-sm" />
                </Field>
                <Field label="Finish">
                  <Input type="date" value={draft.end_date} disabled={!editable} onChange={(e) => patch({ end_date: e.target.value })} className="h-8 text-sm" />
                </Field>
              </div>
            )}

            {a.kind === "work_order" && draft.terms.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground font-medium uppercase">Owner and association requirements (from the client contract)</span>
                {draft.terms.map((t, i) => (
                  <label key={i} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-amber-600"
                      checked={t.checked}
                      disabled={!editable}
                      onChange={(e) => patch({ terms: draft.terms.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)) })}
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">{t.title}.</span> <span className="text-muted-foreground">{t.body}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* Where it stands */}
            <div className="rounded-lg border p-3 space-y-2 text-xs">
              <p className="text-muted-foreground">
                Template: {data.template.title} v{data.template.version} ·{" "}
                {data.template.status === "approved" ? "approved" : `draft, ${data.template.blanks} blank${data.template.blanks === 1 ? "" : "s"} left`}
                {data.template.test_only ? " · TEST only" : ""} ·{" "}
                <Link href="/subcontractors/agreements" className="text-amber-500 underline">
                  Agreement text
                </Link>
              </p>
              {a.kind === "work_order" && (
                <p className="text-muted-foreground">
                  Master agreement:{" "}
                  {data.master
                    ? `${data.master.number} (${AGREEMENT_STATUS_LABEL[data.master.status] ?? data.master.status})`
                    : "none this year yet. It goes out with this work order."}
                </p>
              )}
              {a.penney_signed_at && (
                <p>
                  ✓ Signed for Penney by {a.penney_signed_name}
                  {a.penney_signed_title ? `, ${a.penney_signed_title}` : ""} on {formatDate(a.penney_signed_at)}
                </p>
              )}
              {a.sent_at && (
                <p>
                  Sent {formatDate(a.sent_at)}
                  {a.first_viewed_at ? ` · opened ${formatDate(a.first_viewed_at)} (${a.view_count} view${a.view_count === 1 ? "" : "s"})` : " · not opened yet"}
                </p>
              )}
              {a.sub_signed_at && (
                <p className="text-emerald-500">
                  ✓ Signed by {a.sub_signed_name}
                  {a.signed_on_paper ? " on paper" : " in the portal"} on {formatDate(a.sub_signed_at)}
                </p>
              )}
              {a.status === "void" && <p className="text-red-400">Void{a.void_reason ? `: ${a.void_reason}` : ""}</p>}
              {editable && data.blockers.length > 0 && (
                <div>
                  <p className="font-semibold">Before Ryan can sign and send:</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                    {data.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
              {editable && data.blockers.length === 0 && <p className="text-emerald-500">Ready for Ryan to sign and send.</p>}
            </div>

            {/* Sub change orders on a signed work order */}
            {a.kind === "work_order" && (data.change_orders.length > 0 || a.status === "signed") && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground font-medium uppercase">Sub change orders</span>
                {data.change_orders.map((c) => (
                  <button key={c.id} type="button" onClick={() => onOpenOther?.(c.id)} className="flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs">
                    <span className="flex-1">{c.number}</span>
                    <span className="text-muted-foreground">{AGREEMENT_STATUS_LABEL[c.status] ?? c.status}</span>
                    <span className="font-semibold tabular-nums">{money(c.amount)}</span>
                  </button>
                ))}
                {a.status === "signed" && !scoOpen && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setScoOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" /> Sub change order
                  </Button>
                )}
                {scoOpen && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <Textarea value={scoScope} onChange={(e) => setScoScope(e.target.value)} placeholder="What changes" className="text-sm min-h-[60px]" />
                    <Money label="Amount (negative = credit)" value={scoAmount} onChange={setScoAmount} />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setScoOpen(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => void newChangeOrder()} disabled={busy === "sco"}>
                        {busy === "sco" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        Draft it
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button variant="outline" size="sm" asChild>
                <a href={data.pdf_url} target="_blank" rel="noreferrer">
                  {a.status === "draft" ? "Preview PDF" : "PDF"}
                </a>
              </Button>
              {editable && (
                <Button size="sm" variant="outline" onClick={() => void save()} disabled={!dirty || busy === "save"}>
                  {busy === "save" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  Save draft
                </Button>
              )}
              {editable && data.viewer.can_sign && (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  // Unsaved edits are saved first, and may clear what blocks it.
                  disabled={(!dirty && data.blockers.length > 0) || !!busy}
                  onClick={() => setConfirmSend(true)}
                >
                  Sign and send
                </Button>
              )}
              {editable && !data.viewer.can_sign && <span className="text-xs text-muted-foreground">Ryan signs and sends work orders.</span>}
              {data.viewer.can_sign && (a.status === "draft" || a.status === "sent" || a.status === "viewed") && !paperOpen && (
                <Button size="sm" variant="ghost" onClick={() => setPaperOpen(true)}>
                  Signed on paper?
                </Button>
              )}
              {a.status !== "void" && a.status !== "superseded" && !voidOpen && (
                <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setVoidOpen(true)}>
                  Void
                </Button>
              )}
            </div>

            {confirmSend && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2 text-sm">
                <p>
                  This signs {a.number} as you, for Penney, and puts it in {data.sub.company_name}&apos;s portal to sign.
                  {a.kind === "work_order" && (!data.master || data.master.status === "draft")
                    ? " His master agreement for this year goes with it, signed the same way."
                    : ""}{" "}
                  No email or text is sent.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmSend(false)}>
                    Not yet
                  </Button>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy === "send"} onClick={() => void signAndSend()}>
                    {busy === "send" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Yes, sign and send
                  </Button>
                </div>
              </div>
            )}

            {paperOpen && (
              <div className="rounded-lg border p-3 space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">File a copy he signed on paper. It locks the same way a portal signature does.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Who signed for the sub">
                    <Input value={paperName} onChange={(e) => setPaperName(e.target.value)} className="h-8 text-sm" />
                  </Field>
                  <Field label="Signed on">
                    <Input type="date" value={paperDate} onChange={(e) => setPaperDate(e.target.value)} className="h-8 text-sm" />
                  </Field>
                </div>
                <input ref={paperFile} type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp" className="text-xs" />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setPaperOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => void filePaper()} disabled={busy === "paper"}>
                    {busy === "paper" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    File as signed
                  </Button>
                </div>
              </div>
            )}

            {voidOpen && (
              <div className="rounded-lg border border-red-500/30 p-3 space-y-2 text-sm">
                <Field label={a.status === "draft" && !a.penney_signed_at ? "Reason (optional)" : "Reason (the sub reads this)"}>
                  <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="text-sm min-h-[50px]" />
                </Field>
                {a.status === "signed" && (
                  <p className="text-xs text-amber-500">This unlocks his contract amount on this job and voids its sub change orders.</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setVoidOpen(false)}>
                    Keep it
                  </Button>
                  <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={busy === "void"} onClick={() => void doVoid()}>
                    {busy === "void" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Void {a.number}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1 min-w-0">
      <span className="text-[10px] text-muted-foreground font-medium uppercase">{label}</span>
      {children}
    </div>
  );
}

function Money({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <Field label={`${label} ($)`}>
      <DecimalInput
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        placeholder="0.00"
        className="h-8 w-full rounded-md border bg-transparent px-2 text-sm tabular-nums disabled:opacity-60"
      />
    </Field>
  );
}

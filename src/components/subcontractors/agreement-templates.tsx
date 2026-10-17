"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2, Plus } from "lucide-react";
import { approveTemplate, newTemplateVersion, retireTemplate, saveTemplateDraft } from "@/lib/actions/sub-agreements";
import type { SubAgreementKind, SubAgreementSection } from "@/lib/sub-portal/payload";
import type { TemplateRow } from "@/lib/subs/agreements";
import { AGREEMENT_KIND_LABEL, fillBlank, findFillInBlanks, type FillInBlank } from "@/lib/subs/agreement-format";

/**
 * Ryan's page for the agreement text (ADDENDUM 2). Each section of the
 * drafted text opens with a "DRAFT for Ryan Penney's review" line: "Mark
 * read" takes it out. Each business blank ("[FILL IN: retainage percent…]")
 * gets a box right under the section it sits in. Approve unlocks once
 * nothing is left, and only on Ryan's own login; the app stamps
 * "Reviewed and approved by Ryan Penney on {date}" and the text freezes. A
 * later change is a new version.
 */

const KINDS: SubAgreementKind[] = ["master", "work_order", "change_order"];

const KIND_HELP: Record<SubAgreementKind, string> = {
  master: "Each sub signs this once a year. It has the terms for every job.",
  work_order: "The terms printed on every job's work order, under the scope, price and dates.",
  change_order: "The terms on a written change to a signed work order.",
};

interface DraftText {
  title: string;
  sections: SubAgreementSection[];
  acceptance_text: string;
  esign_consent_text: string;
}

const toDraft = (t: TemplateRow): DraftText => ({
  title: t.title,
  sections: t.sections.map((s) => ({ ...s })),
  acceptance_text: t.acceptance_text,
  esign_consent_text: t.esign_consent_text,
});

function blanksOf(text: string) {
  return findFillInBlanks(text);
}

function countDraft(d: DraftText) {
  const all = [d.acceptance_text, d.esign_consent_text, ...d.sections.flatMap((s) => [s.title, s.body])].flatMap(blanksOf);
  return { review: all.filter((b) => b.isReview).length, business: all.filter((b) => !b.isReview).length, total: all.length };
}

export function AgreementTemplates({
  templates,
  viewer,
}: {
  templates: TemplateRow[];
  viewer: { canApprove: boolean; canEdit: boolean; name: string; impersonating: boolean };
}) {
  const [kind, setKind] = useState<SubAgreementKind>("master");
  const ofKind = templates.filter((t) => t.kind === kind).sort((a, b) => b.version - a.version);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-2xl border bg-card p-4 text-sm space-y-1">
        <p className="font-semibold">Drafted for Ryan&apos;s review. Penney has no lawyer on this, so read every section.</p>
        <p className="text-muted-foreground">
          Plain-English terms, standard for a residential GC, written around the Massachusetts rules (independent contractor c.149 §148B,
          indemnity c.149 §29C, workers&apos; comp c.152 §18, lien waivers c.254 §32, e-signatures c.110G). Until a template is approved,
          every agreement PDF says DRAFT and nothing can be sent to a sub.
          {!viewer.canApprove && " Only Ryan can approve."}
          {viewer.impersonating && " You're viewing as someone else, so approving is off."}
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {KINDS.map((k) => {
          const live = templates.find((t) => t.kind === k && t.status === "approved" && !t.test_only);
          return (
            <Button key={k} size="sm" variant={k === kind ? "default" : "outline"} onClick={() => setKind(k)}>
              {AGREEMENT_KIND_LABEL[k]}
              {live ? <Check className="h-3.5 w-3.5 ml-1.5 text-emerald-500" /> : null}
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{KIND_HELP[kind]}</p>

      {ofKind.map((t) => (
        <TemplateCard key={t.id} template={t} viewer={viewer} />
      ))}

      {viewer.canEdit && (
        <div className="flex gap-2 flex-wrap">
          {!ofKind.some((t) => t.status === "draft" && !t.test_only) && <NewVersionButton kind={kind} label="New version to edit" />}
          {!ofKind.some((t) => t.status === "draft" && t.test_only) && <NewVersionButton kind={kind} testOnly label="New TEST-only version" />}
        </div>
      )}
    </div>
  );
}

function NewVersionButton({ kind, testOnly, label }: { kind: SubAgreementKind; testOnly?: boolean; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await newTemplateVersion(kind, { testOnly });
          setBusy(false);
          if (res.error !== null) setError(res.error);
          else router.refresh();
        }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
        {label}
      </Button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function TemplateCard({ template: t, viewer }: { template: TemplateRow; viewer: { canApprove: boolean; canEdit: boolean; name: string; impersonating: boolean } }) {
  const router = useRouter();
  const editable = t.status === "draft" && viewer.canEdit;
  const [draft, setDraft] = useState<DraftText>(() => toDraft(t));
  const [dirty, setDirty] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [open, setOpen] = useState(t.status === "draft");

  const counts = useMemo(() => countDraft(draft), [draft]);
  const provenancePreview = `Reviewed and approved by ${viewer.name} on ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })}`;

  function change(next: DraftText) {
    setDraft(next);
    setDirty(true);
    setConfirmApprove(false);
    setMessage(null);
  }

  /** Apply one blank in one field; field = "acceptance" | "consent" | "s{i}.title" | "s{i}.body". */
  function applyBlank(field: string, blank: FillInBlank, answer: string) {
    const get = (d: DraftText): string => {
      if (field === "acceptance") return d.acceptance_text;
      if (field === "consent") return d.esign_consent_text;
      const [, i, part] = field.match(/^s(\d+)\.(title|body)$/) ?? [];
      return d.sections[Number(i)]?.[part as "title" | "body"] ?? "";
    };
    const nextText = fillBlank(get(draft), blank, answer);
    const next: DraftText = { ...draft, sections: draft.sections.map((s) => ({ ...s })) };
    if (field === "acceptance") next.acceptance_text = nextText;
    else if (field === "consent") next.esign_consent_text = nextText;
    else {
      const [, i, part] = field.match(/^s(\d+)\.(title|body)$/) ?? [];
      next.sections[Number(i)][part as "title" | "body"] = nextText;
    }
    setAnswers((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${field}|`))));
    change(next);
  }

  async function save() {
    setBusy("save");
    setError(null);
    const res = await saveTemplateDraft(t.id, draft);
    setBusy(null);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    setDirty(false);
    setMessage(res.data.blanks ? `Saved. ${res.data.blanks} left.` : "Saved. Nothing left to fill.");
    router.refresh();
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    const res = await approveTemplate(t.id);
    setBusy(null);
    setConfirmApprove(false);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    const waiting = res.data.outstanding;
    setMessage(
      `Approved. ${res.data.provenance}.${waiting ? ` ${waiting} sent agreement${waiting === 1 ? " stays" : "s stay"} on the older version until signed.` : ""}`,
    );
    router.refresh();
  }

  async function retire() {
    setBusy("retire");
    const res = await retireTemplate(t.id);
    setBusy(null);
    if (res.error !== null) setError(res.error);
    else router.refresh();
  }

  const statusBadge =
    t.status === "approved" ? (
      <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Approved</Badge>
    ) : t.status === "retired" ? (
      <Badge variant="outline">Retired</Badge>
    ) : (
      <Badge variant="outline" className="text-amber-500 border-amber-500/30">
        Draft
      </Badge>
    );

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left min-w-0">
        <span className="flex-1 min-w-0 font-semibold truncate">
          {draft.title} · v{t.version}
        </span>
        {t.test_only && <Badge variant="outline">TEST only</Badge>}
        {statusBadge}
        {t.status === "draft" && (
          <span className="text-xs text-muted-foreground shrink-0">
            {counts.review} to read · {counts.business} to fill
          </span>
        )}
      </button>

      {open && (
        <div className="border-t px-4 py-4 space-y-4">
          {t.provenance && <p className="text-xs text-emerald-500">{t.provenance}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && <p className="text-sm text-emerald-500">{message}</p>}

          {editable && (
            <div>
              <label className="text-[10px] text-muted-foreground font-medium uppercase">Title</label>
              <Input value={draft.title} onChange={(e) => change({ ...draft, title: e.target.value })} className="h-8 text-sm" />
            </div>
          )}

          {draft.sections.map((s, i) => (
            <TextBlock
              key={i}
              number={i + 1}
              title={s.title}
              body={s.body}
              editable={editable}
              fieldBase={`s${i}`}
              answers={answers}
              setAnswer={(k, v) => setAnswers((prev) => ({ ...prev, [k]: v }))}
              onApply={applyBlank}
              onTitle={(v) => change({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, title: v } : x)) })}
              onBody={(v) => change({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, body: v } : x)) })}
              onRemove={() => change({ ...draft, sections: draft.sections.filter((_, j) => j !== i) })}
            />
          ))}
          {editable && (
            <Button size="sm" variant="ghost" onClick={() => change({ ...draft, sections: [...draft.sections, { title: "New section", body: "" }] })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Section
            </Button>
          )}

          <TextBlock
            title="Acceptance statement (printed above the signatures)"
            body={draft.acceptance_text}
            editable={editable}
            fieldBase="acceptance"
            answers={answers}
            setAnswer={(k, v) => setAnswers((prev) => ({ ...prev, [k]: v }))}
            onApply={applyBlank}
            onBody={(v) => change({ ...draft, acceptance_text: v })}
          />
          <TextBlock
            title="E-sign consent (the box the sub ticks before signing)"
            body={draft.esign_consent_text}
            editable={editable}
            fieldBase="consent"
            answers={answers}
            setAnswer={(k, v) => setAnswers((prev) => ({ ...prev, [k]: v }))}
            onApply={applyBlank}
            onBody={(v) => change({ ...draft, esign_consent_text: v })}
          />

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {editable && (
              <Button size="sm" variant="outline" disabled={!dirty || busy === "save"} onClick={() => void save()}>
                {busy === "save" && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Save
              </Button>
            )}
            {t.status === "draft" && viewer.canApprove && !viewer.impersonating && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={dirty || counts.total > 0 || !!busy}
                onClick={() => setConfirmApprove(true)}
              >
                Approve
              </Button>
            )}
            {t.status === "draft" && counts.total > 0 && (
              <span className="text-xs text-muted-foreground">
                Approve unlocks when every section is read and every blank is filled ({counts.total} left).
              </span>
            )}
            {t.status === "draft" && dirty && counts.total === 0 && <span className="text-xs text-muted-foreground">Save first, then approve.</span>}
            {t.status === "approved" && viewer.canApprove && !viewer.impersonating && (
              <Button size="sm" variant="ghost" disabled={busy === "retire"} onClick={() => void retire()}>
                Retire
              </Button>
            )}
            {t.status === "approved" && <span className="text-xs text-muted-foreground">Approved text can&apos;t change. Make a new version to edit it.</span>}
          </div>

          {confirmApprove && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2 text-sm">
              <p>
                This makes {draft.title} v{t.version} the text every new {AGREEMENT_KIND_LABEL[t.kind].toLowerCase()} uses
                {t.test_only ? " (TEST subs only)" : ""}. It is stamped &ldquo;{provenancePreview}&rdquo; and can&apos;t be changed after.
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmApprove(false)}>
                  Not yet
                </Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy === "approve"} onClick={() => void approve()}>
                  {busy === "approve" && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Yes, approve
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TextBlock({
  number,
  title,
  body,
  editable,
  fieldBase,
  answers,
  setAnswer,
  onApply,
  onTitle,
  onBody,
  onRemove,
}: {
  number?: number;
  title: string;
  body: string;
  editable: boolean;
  fieldBase: string;
  answers: Record<string, string>;
  setAnswer: (key: string, value: string) => void;
  onApply: (field: string, blank: FillInBlank, answer: string) => void;
  onTitle?: (v: string) => void;
  onBody: (v: string) => void;
  onRemove?: () => void;
}) {
  const bodyField = number != null ? `${fieldBase}.body` : fieldBase;
  const blanks = blanksOf(body);
  const review = blanks.find((b) => b.isReview);
  const business = blanks.filter((b) => !b.isReview);
  const titleBlanks = number != null ? blanksOf(title) : [];

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${review ? "border-amber-500/40" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        {number != null && <span className="text-sm font-bold shrink-0">{number}.</span>}
        {editable && onTitle ? (
          <Input value={title} onChange={(e) => onTitle(e.target.value)} className="h-8 text-sm font-semibold" />
        ) : (
          <span className="text-sm font-semibold min-w-0">{title}</span>
        )}
        {review && (
          <Badge variant="outline" className="text-amber-500 border-amber-500/30 shrink-0">
            Not read yet
          </Badge>
        )}
      </div>
      {titleBlanks.length > 0 && <p className="text-xs text-amber-500">The title has a [FILL IN] blank. Edit it above.</p>}

      {editable ? (
        <Textarea value={body} onChange={(e) => onBody(e.target.value)} className="text-sm min-h-[120px] font-normal leading-relaxed" />
      ) : (
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{body}</p>
      )}

      {editable && business.length > 0 && (
        <div className="space-y-2 rounded-lg bg-muted/40 p-2">
          {business.map((b, i) => {
            const key = `${bodyField}|${i}`;
            const value = answers[key] ?? "";
            return (
              <div key={key} className="space-y-1">
                <p className="text-xs text-muted-foreground">Fill in: {b.prompt || "this blank"}</p>
                <div className="flex gap-2">
                  <Input value={value} onChange={(e) => setAnswer(key, e.target.value)} className="h-8 text-sm" placeholder="Your answer" />
                  <Button size="sm" variant="outline" disabled={!value.trim()} onClick={() => onApply(bodyField, b, value.trim())}>
                    Fill
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editable && (
        <div className="flex gap-2">
          {review && (
            <Button size="sm" variant="outline" onClick={() => onApply(bodyField, review, "")}>
              <Check className="h-3.5 w-3.5 mr-1" /> Mark read
            </Button>
          )}
          {onRemove && (
            <Button size="sm" variant="ghost" className="text-red-400" onClick={onRemove}>
              Remove section
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

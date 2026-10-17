"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PortalNotice, PortalSheet, usePortalAction, type PortalNoticeValue } from "@/components/portal-kit";
import { fmtDate, fmtMoney, fmtRange } from "@/lib/portal-kit/format";
import type { SubActionResponse, SubAgreementDetail } from "@/lib/sub-portal/payload";
import { AGREEMENT_KIND_LABEL, priceLines, withoutReviewLines } from "@/lib/subs/agreement-format";

/**
 * Review and sign one agreement in the sub portal (plan §5.4): a work
 * order, the yearly master agreement, or a sub change order.
 *
 * What he sees, top to bottom: the job, the scope as written, what's not
 * included, the price to the cent, the payments and dates, the owner's
 * requirements, the terms (each section opens on tap), the full PDF, then
 * the consent box and his typed name. Copied from the client contract's
 * sign page (consent + typed name), not its 3-day cancel notice: that is a
 * homeowner right (c.142A), not a sub's.
 *
 * A work order whose master agreement isn't signed yet asks for that first
 * and opens it in place. In the staff preview everything shows and nothing
 * can be tapped through.
 */

type DetailResponse = SubActionResponse<{ agreement: SubAgreementDetail }>;

export function SignSheet({
  agreementId,
  preview,
  onClose,
  onSigned,
  onChanged,
}: {
  agreementId: string;
  preview: boolean;
  onClose: () => void;
  /** The agreement this sheet was opened for is signed; the parent closes the sheet. */
  onSigned: () => void;
  /** Something else was signed on the way (the master agreement): refresh without closing. */
  onChanged?: () => void;
}) {
  // The sheet can step over to the master agreement and back.
  const [currentId, setCurrentId] = useState(agreementId);
  const [detail, setDetail] = useState<SubAgreementDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [consentedAt, setConsentedAt] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [signedNotice, setSignedNotice] = useState<PortalNoticeValue | null>(null);
  const action = usePortalAction("/api/sub-portal/agreements", !preview);

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/sub-portal/agreements?id=${encodeURIComponent(id)}${preview ? "&preview=1" : ""}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as DetailResponse | null;
        if (!res.ok || !data || !("agreement" in data)) {
          setLoadError((data && "error" in data && data.error) || "Couldn't open this. Check your signal and try again.");
          setDetail(null);
        } else {
          setDetail(data.agreement);
        }
      } catch {
        setLoadError("No connection. Check your signal and try again.");
      } finally {
        setLoading(false);
      }
    },
    [preview],
  );

  useEffect(() => {
    void load(currentId);
  }, [currentId, load]);

  function open(id: string) {
    setAgreed(false);
    setConsentedAt(null);
    setName("");
    setSignedNotice(null);
    action.clearNotice();
    setCurrentId(id);
  }

  async function sign() {
    if (!detail || !agreed || name.trim().length < 2 || !detail.pdf_sha256) return;
    const res = await action.run<{ ok: true; number: string; signed_at: string }>(
      `sign:${detail.id}`,
      { action: "sign", id: detail.id, name: name.trim(), consent: true, pdfSha256: detail.pdf_sha256, consentedAt: consentedAt ?? undefined },
    );
    if (!res) return;
    if (currentId !== agreementId) {
      // The master is signed; the work order that was waiting on it isn't.
      // Stay open and go back to it (it reloads, now signable).
      onChanged?.();
      open(agreementId);
      // After open(), which clears the notice.
      setSignedNotice({ tone: "success", text: `Signed ${res.number}. Now review and sign the work order.` });
      return;
    }
    setSignedNotice({ tone: "success", text: `Signed. Penney has your signature on ${res.number}.` });
    onSigned();
    void load(currentId);
  }

  const d = detail;
  const kindWord = d ? AGREEMENT_KIND_LABEL[d.kind] : "Agreement";
  const masterFirst = !!d && d.kind === "work_order" && !!d.master && !d.master.sub_signed_at && d.status !== "signed";
  const awaiting = !!d && (d.status === "sent" || d.status === "viewed");
  const signable = !!d && awaiting && (d.can_sign || preview) && !masterFirst;
  const busy = d ? action.isBusy(`sign:${d.id}`) : false;

  return (
    <PortalSheet
      title={d ? `${kindWord} ${d.number}` : "Agreement"}
      onClose={onClose}
      locked={busy}
      footer={
        signable ? (
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={preview || busy || !agreed || name.trim().length < 2}
            onClick={() => void sign()}
          >
            {busy ? "Signing…" : `Sign ${d!.number}`}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {preview && <PortalNotice notice={{ tone: "info", text: "Staff preview. Nothing you tap here is saved." }} />}
        {currentId !== agreementId && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => open(agreementId)}>
            ‹ Back to the work order
          </button>
        )}
        <PortalNotice notice={signedNotice} onDismiss={() => setSignedNotice(null)} />
        <PortalNotice notice={action.notice} onDismiss={action.clearNotice} />

        {loading && !d && <p className="text-[var(--muted)]">Opening…</p>}
        {loadError && <PortalNotice notice={{ tone: "error", text: loadError }} />}

        {d && (
          <>
            <div className="card p-4">
              <p className="label">{d.project_name ?? "Penney Construction"}</p>
              <p className="mt-1 text-[18px] font-extrabold leading-snug">
                {kindWord} {d.number}
              </p>
              {d.parent_number && <p className="mt-1 text-[var(--muted)]">Changes work order {d.parent_number}</p>}
              <p className="mt-2 font-semibold">
                {d.status === "signed"
                  ? `✓ Signed${d.sub_signed?.on_paper ? " on paper" : ""}${d.sub_signed_at ? ` ${fmtDate(d.sub_signed_at)}` : ""}`
                  : d.status === "void"
                    ? "Cancelled by Penney"
                    : "● Waiting for your signature"}
              </p>
            </div>

            {d.status === "void" && d.void_reason && (
              <PortalNotice notice={{ tone: "info", text: `Penney cancelled this: ${d.void_reason}` }} />
            )}

            {masterFirst && d.master && (
              <div className="card space-y-3 p-4">
                <p className="font-bold">First, sign your master agreement {d.master.number}.</p>
                <p className="text-[var(--muted)]">It has the terms for every Penney job this year. You sign it once, then this work order.</p>
                <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => open(d.master!.id)}>
                  Open {d.master.number} ›
                </button>
              </div>
            )}

            {d.kind !== "master" && (
              <>
                <Block label={d.kind === "change_order" ? "What changes" : "Scope"}>
                  <p className="whitespace-pre-wrap">{d.scope_text || "—"}</p>
                </Block>
                {d.exclusions_text && (
                  <Block label="Not included">
                    <p className="whitespace-pre-wrap">{d.exclusions_text}</p>
                  </Block>
                )}
                <Block label={d.kind === "change_order" ? "Amount" : "Price"}>
                  {priceLines(d, (n) => fmtMoney(n)).map((line) => (
                    <p key={line} className="text-[17px] font-bold">
                      {line}
                    </p>
                  ))}
                  {d.kind === "change_order" && d.price != null && d.price < 0 && (
                    <p className="mt-1 text-[var(--muted)]">A credit to Penney.</p>
                  )}
                </Block>
                {d.draws.length > 0 && (
                  <Block label="Payments">
                    <ul className="divide-y divide-[var(--line)]">
                      {d.draws.map((draw, i) => (
                        <li key={i} className="flex min-h-[44px] items-center justify-between gap-3 py-2">
                          <span className="min-w-0">
                            <span className="font-semibold">{draw.label || "Payment"}</span>
                            {draw.when && <span className="block text-[var(--muted)]">{draw.when}</span>}
                          </span>
                          <span className="shrink-0 font-bold">
                            {draw.amount != null ? fmtMoney(draw.amount) : draw.percent != null ? `${draw.percent}%` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
                {d.kind === "work_order" && (
                  <Block label="Dates">
                    <p>{d.start_date ? fmtRange(d.start_date, d.end_date) : "Set and confirmed in your Dates tab"}</p>
                  </Block>
                )}
                {d.additional_terms.length > 0 && (
                  <Block label="Owner and building rules for this job">
                    <Sections sections={d.additional_terms} />
                  </Block>
                )}
              </>
            )}

            <Block label={d.kind === "master" ? "The terms" : "Terms"}>
              {d.kind !== "master" && d.master && (
                <p className="mb-2 text-[var(--muted)]">Under your master agreement {d.master.number}.</p>
              )}
              <Sections sections={d.template.sections.map((s) => ({ title: s.title, body: withoutReviewLines(s.body) }))} />
              <a href={d.pdf_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-block mt-3">
                Open the full document (PDF) ›
              </a>
            </Block>

            {d.penney_signed && (
              <p className="text-[var(--muted)]">
                ✓ Signed for Penney by {d.penney_signed.name}
                {d.penney_signed.title ? `, ${d.penney_signed.title}` : ""} on {fmtDate(d.penney_signed.at)}
              </p>
            )}

            {d.status === "signed" && d.sub_signed && (
              <p className="font-semibold">
                ✓ Signed by {d.sub_signed.name || "you"}
                {d.sub_signed.on_paper ? " on paper" : ""} on {fmtDate(d.sub_signed.at)}
              </p>
            )}

            {signable && (
              <div className="card space-y-4 p-4">
                <p className="font-semibold whitespace-pre-wrap">{withoutReviewLines(d.template.acceptance_text)}</p>
                <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={agreed}
                    disabled={preview}
                    onChange={(e) => {
                      setAgreed(e.target.checked);
                      setConsentedAt(e.target.checked ? new Date().toISOString() : null);
                    }}
                    className="mt-1 h-6 w-6 shrink-0 accent-[var(--accent-dark)]"
                  />
                  <span className="whitespace-pre-wrap">{withoutReviewLines(d.template.esign_consent_text)}</span>
                </label>
                <div>
                  <label htmlFor="pc-sign-name" className="label">
                    Your full name
                  </label>
                  <input
                    id="pc-sign-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    disabled={preview}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Type your full name"
                    className="mt-1 w-full border-b-2 border-[var(--ink)] bg-transparent px-1 py-3 text-[var(--ink)] outline-none placeholder:text-[16px] placeholder:not-italic placeholder:text-[var(--muted)]"
                    style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 24, fontStyle: "italic" }}
                  />
                  <p className="mt-2 text-[14px] text-[var(--muted)]">
                    Your name, the time, your login and your device are saved with your signature.
                  </p>
                </div>
              </div>
            )}

            {awaiting && !d.can_sign && !preview && !masterFirst && (
              <PortalNotice notice={{ tone: "info", text: "This isn't ready to sign yet. Call the office if you were expecting it." }} />
            )}
          </>
        )}
      </div>
    </PortalSheet>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <p className="label mb-2">{label}</p>
      {children}
    </section>
  );
}

/** Each section folds; the summary row is a 60px target. */
function Sections({ sections }: { sections: { title: string; body: string }[] }) {
  if (sections.length === 0) return null;
  return (
    <div className="divide-y divide-[var(--line)]">
      {sections.map((s, i) => (
        <details key={`${i}-${s.title}`} className="group">
          <summary className="flex min-h-[60px] cursor-pointer list-none items-center justify-between gap-3 py-2 font-semibold">
            <span className="min-w-0">
              {i + 1}. {s.title}
            </span>
            <span aria-hidden className="shrink-0 text-[var(--muted)] group-open:hidden">
              ›
            </span>
          </summary>
          <p className="whitespace-pre-wrap pb-3">{s.body}</p>
        </details>
      ))}
    </div>
  );
}

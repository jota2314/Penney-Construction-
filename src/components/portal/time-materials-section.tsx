import { formatMoney } from "@/lib/money";
import { summarizePortalTM } from "@/lib/portal/time-materials";
import type { PortalChangeOrder, PortalTimeMaterialEntry } from "@/lib/portal/types";

const money = (value: number) => formatMoney(value, { cents: "always" });
const quantity = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });
const rate = (value: number) => value.toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4,
});
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
  month: "short", day: "numeric", year: "numeric",
});
const labels = { labor: "Labor", material: "Materials", equipment: "Equipment", other: "Other" } as const;

export function TimeMaterialsSection({ changeOrders }: { changeOrders: PortalChangeOrder[] }) {
  const orders = changeOrders.filter((co) => co.billing_type === "time_materials");
  if (!orders.length) return null;
  return (
    <section aria-labelledby="tm-heading" className="space-y-3">
      <div className="px-1">
        <h2 id="tm-heading" className="text-[20px] font-extrabold">Time &amp; materials</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-[var(--muted)]">
          Follow the hours, quantities and charges shared for each change order. These running charges are separate from the contract value shown above. Invoices show amounts billed.
        </p>
      </div>
      {orders.map((co) => <TimeMaterialsOrder key={co.id} order={co} />)}
    </section>
  );
}

function TimeMaterialsOrder({ order }: { order: PortalChangeOrder }) {
  const entries = order.tm_entries ?? [];
  const summary = summarizePortalTM(entries);
  const hasPricedEntries = entries.some((entry) => entry.status === "published" && entry.amount != null);
  const inactive = order.status === "rejected" || order.status === "void";
  return (
    <article className="card overflow-hidden" aria-labelledby={`tm-${order.id}`}>
      <div className="p-4">
        <p className="label">Change order {order.change_order_number} · T&amp;M</p>
        <h3 id={`tm-${order.id}`} className="mt-1 break-words text-[18px] font-extrabold leading-snug">{order.title}</h3>
        <p className="mt-1 text-[13px] text-[var(--muted)]">{inactive ? (order.status === "void" ? "Voided" : "Rejected") : order.signed || order.status === "approved" ? "Approved" : "Awaiting your signature"}</p>
        {order.tm_terms && <p className="mt-3 whitespace-pre-line break-words text-[14px] leading-relaxed">{order.tm_terms}</p>}
        {order.tm_entries === null ? (
          <p role="status" className="mt-4 rounded-xl bg-[var(--paper)] p-3 text-[14px]">
            The time &amp; materials log is temporarily unavailable. Please refresh to load the recorded work.
          </p>
        ) : (
          <>
            <div className="mt-4 rounded-xl bg-[var(--paper)] p-3">
              <p className="label">{summary.pendingRates ? "Priced charges to date" : "Recorded charges to date"}</p>
              <p className="mt-1 break-words text-[28px] font-extrabold leading-tight">{hasPricedEntries ? money(summary.total) : "Pending"}</p>
              {summary.entryCount > 0 && <p className="mt-1 text-[13px] text-[var(--muted)]">{quantity(summary.hours)} labor hours · {summary.entryCount} shared entr{summary.entryCount === 1 ? "y" : "ies"}</p>}
              {summary.pendingRates > 0 && <p className="mt-1 text-[13px] font-semibold text-[var(--accent-dark)]">{summary.pendingRates} entr{summary.pendingRates === 1 ? "y is" : "ies are"} awaiting a rate. The total will change.</p>}
              {summary.draftCount > 0 && <p className="mt-1 text-[13px] text-[var(--muted)]">Staff preview: {summary.draftCount} draft entr{summary.draftCount === 1 ? "y" : "ies"} excluded from totals and hidden from the client.</p>}
              {summary.entryCount === 0 && <p className="mt-1 text-[14px] text-[var(--muted)]">Hours and materials will appear here after the team shares the recorded work.</p>}
            </div>
            {summary.entryCount > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {(Object.keys(labels) as (keyof typeof labels)[]).filter((category) => entries.some((entry) => entry.status === "published" && entry.category === category)).map((category) => {
                  const rows = entries.filter((entry) => entry.status === "published" && entry.category === category);
                  const pending = rows.some((entry) => entry.amount == null);
                  const priced = rows.some((entry) => entry.amount != null);
                  return <div key={category} className="min-w-0">
                    <dt className="text-[13px] text-[var(--muted)]">{labels[category]}</dt>
                    <dd className="break-words text-[16px] font-bold">{priced ? money(summary.categories[category]) : "Pending"}{pending && priced ? " + pending" : ""}</dd>
                  </div>;
                })}
              </dl>
            )}
          </>
        )}
      </div>
      {order.tm_entries !== null && entries.length > 0 && (
        <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]" aria-label={`Recorded work for change order ${order.change_order_number}`}>
          {entries.map((entry) => <TimeMaterialsEntry key={entry.id} entry={entry} />)}
        </ul>
      )}
      {order.url && !inactive && <div className="border-t border-[var(--line)] px-4 py-3">
        <a href={order.url} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center text-[14px] font-bold text-[var(--accent-dark)]">
          {order.signed || order.status === "approved" ? "View change order" : "Review and sign change order"} →
        </a>
      </div>}
    </article>
  );
}

function TimeMaterialsEntry({ entry }: { entry: PortalTimeMaterialEntry }) {
  const voided = entry.status === "void";
  return (
    <li className={`px-4 py-3 ${voided ? "bg-[var(--paper)]" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-[var(--muted)]">
        <span>{date(entry.work_date)} · {labels[entry.category]}</span>
        {entry.status === "draft" && <strong className="text-[var(--accent-dark)]">Draft · hidden from client</strong>}
        {voided && <strong>Voided · excluded from total</strong>}
      </div>
      <p className={`mt-1 break-words text-[15px] font-semibold ${voided ? "line-through text-[var(--muted)]" : ""}`}>{entry.description}</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="break-words text-[14px] text-[var(--muted)]">{quantity(entry.quantity)} {entry.unit} × {entry.unit_rate == null ? "rate pending" : rate(entry.unit_rate)}</p>
        <p className={`text-[16px] font-extrabold ${voided ? "line-through text-[var(--muted)]" : ""}`}>{entry.amount == null ? "Amount pending" : money(entry.amount)}</p>
      </div>
      {voided && entry.void_reason && <p className="mt-1 break-words text-[13px] text-[var(--muted)]">{entry.void_reason}</p>}
    </li>
  );
}

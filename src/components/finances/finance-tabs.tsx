import Link from "next/link";

// Shared navigation for the Finances area.
const TABS = [
  { key: "daily", label: "Daily Log", href: "/finances/daily-log" },
  { key: "overview", label: "Overview", href: "/money" },
  { key: "expenses", label: "Expenses", href: "/spent" },
  { key: "income", label: "Income", href: "/payments" },
  { key: "overhead", label: "Overhead", href: "/overhead" },
  { key: "weekly", label: "Weekly Close", href: "/week" },
] as const;

export type FinanceTabKey = (typeof TABS)[number]["key"];

export function FinanceTabs({ current }: { current: FinanceTabKey }) {
  return (
    <div className="flex items-center gap-4 border-b overflow-x-auto">
      {TABS.map(t => (
        <Link
          key={t.key}
          href={t.href}
          className={`shrink-0 pb-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
            t.key === current
              ? "border-amber-500 text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

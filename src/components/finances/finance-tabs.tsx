import Link from "next/link";
export type FinanceTabKey = "daily" | "overview" | "expenses" | "income" | "overhead" | "weekly";
export function FinanceTabs({ current }: { current: FinanceTabKey }) {
  const section = { daily: "activity", overview: "cash", expenses: "expenses", income: "income", overhead: "overhead", weekly: "weekly" }[current];
  return <Link href={`/finances#${section}`} className="text-sm font-medium underline underline-offset-4">Back to Finance workspace</Link>;
}

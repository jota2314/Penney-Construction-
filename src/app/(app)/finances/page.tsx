import { redirect } from "next/navigation";

// Finances opens the daily workspace; reports remain available in the tabs.
export default function FinancesPage() {
  redirect("/finances/daily-log");
}

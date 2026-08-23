import { redirect } from "next/navigation";

// The one finance destination. The sections are routes wearing shared chrome
// (FinanceTabs): Overview (/money), Expenses (/spent), Income (/payments),
// Weekly Close (/week). Land on the Overview — came in / went out / kept.
export default function FinancesPage() {
  redirect("/money");
}

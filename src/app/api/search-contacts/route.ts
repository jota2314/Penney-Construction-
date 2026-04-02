import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/search-contacts?q=ryan
 * Searches team members, employees, subcontractors, and customers by name.
 * Returns matching contacts with emails for autocomplete.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim().toLowerCase();

  if (!q || q.length < 1) {
    return NextResponse.json({ contacts: [] });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  interface Contact {
    name: string;
    email: string;
    type: string;
  }

  const contacts: Contact[] = [];
  const seenEmails = new Set<string>();

  function add(name: string, email: string | null, type: string) {
    if (!email) return;
    const emailLower = email.toLowerCase();
    if (seenEmails.has(emailLower)) return;
    seenEmails.add(emailLower);
    contacts.push({ name, email, type });
  }

  // Office team (hardcoded — always available)
  const team = [
    { name: "Ryan Penney", email: "rpenney@penneyconstructioninc.com", type: "Team" },
    { name: "Jorge Betancur", email: "jbetancur@penneyconstructioninc.com", type: "Team" },
    { name: "Nicole Smith", email: "nsmith@penneyconstructioninc.com", type: "Team" },
  ];
  for (const t of team) {
    if (t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q)) {
      add(t.name, t.email, t.type);
    }
  }

  // Employees
  const { data: employees } = await supabase
    .from("employees")
    .select("first_name, last_name, email, title")
    .eq("status", "active");

  for (const e of employees ?? []) {
    const fullName = `${e.first_name} ${e.last_name}`;
    if (
      fullName.toLowerCase().includes(q) ||
      e.email?.toLowerCase().includes(q) ||
      e.title?.toLowerCase().includes(q)
    ) {
      add(fullName, e.email, `Employee — ${e.title || ""}`);
    }
  }

  // Subcontractors
  const { data: subs } = await supabase
    .from("subcontractors")
    .select("company_name, contact_name, email")
    .eq("is_active", true);

  for (const s of subs ?? []) {
    const name = s.contact_name
      ? `${s.contact_name} (${s.company_name})`
      : s.company_name;
    if (
      name.toLowerCase().includes(q) ||
      s.company_name?.toLowerCase().includes(q) ||
      s.contact_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q)
    ) {
      add(name, s.email, "Sub");
    }
  }

  // Customers
  const { data: customers } = await supabase
    .from("customers")
    .select("first_name, last_name, email");

  for (const c of customers ?? []) {
    const fullName = `${c.first_name} ${c.last_name}`;
    if (
      fullName.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    ) {
      add(fullName, c.email, "Client");
    }
  }

  return NextResponse.json({ contacts: contacts.slice(0, 10) });
}

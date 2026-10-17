import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { financialRows } from "@/lib/crew/load-labor-ledger";
import { searchTransactions, TRANSACTION_SEARCH_PAGE_SIZE, type TransactionSearchData } from "@/lib/finance/transaction-search";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Sign in to search financial transactions." }, { status: 401, headers });
    if (!canSeeBoardMoney(user.profile?.role))
      return NextResponse.json({ error: "Office financial access required." }, { status: 403, headers });

    const query = request.nextUrl.searchParams.get("q") ?? "";
    const pageValue = request.nextUrl.searchParams.get("page") ?? "1";
    const page = Number(pageValue);
    if (query.length > 200 || !/^[1-9]\d*$/.test(pageValue) || !Number.isSafeInteger(page))
      return NextResponse.json({ error: "Use a search of 200 characters or fewer and a valid page number." }, { status: 400, headers });
    if (!query.trim()) return NextResponse.json({ results: [], total: 0, page, pageSize: TRANSACTION_SEARCH_PAGE_SIZE }, { headers });

    // Read through the signed-in user's RLS. Fetch complete inventories before
    // grouping/searching, including older and undated transactions.
    const db = await createClient();
    const [expenses, income, clientInvoices, bank, projects] = await Promise.all([
      financialRows((from, to) => db.from("invoices")
        .select("id,project_id,vendor_name,amount,description,source,review_status,invoice_number,invoice_date,split_group_id,payment_status,payment_method,duplicate_of_id,projects(name,project_number)")
        .is("duplicate_of_id", null).order("id").range(from, to)),
      financialRows((from, to) => db.from("payments_received")
        .select("id,project_id,amount,description,source,review_status,payer_name,received_date,reference_number,method,projects(name,project_number)")
        .order("id").range(from, to)),
      financialRows((from, to) => db.from("client_invoices")
        .select("id,project_id,invoice_number,title,description,line_items,source,amount,paid_amount,status,invoice_date,created_at,due_date")
        .order("id").range(from, to)),
      financialRows((from, to) => db.from("bank_transactions")
        .select("id,project_id,txn_date,description,amount,direction,check_number,vendor_name,external_ref,card_last4,cardholder,category_key,source")
        .order("id").range(from, to)),
      financialRows((from, to) => db.from("projects")
        .select("id,name,project_number").order("id").range(from, to)),
    ]);
    return NextResponse.json(searchTransactions({ expenses, income, clientInvoices, bank, projects } as TransactionSearchData, query, page), { headers });
  } catch {
    return NextResponse.json({ error: "Transaction search could not load all records. Try again." }, { status: 503, headers });
  }
}

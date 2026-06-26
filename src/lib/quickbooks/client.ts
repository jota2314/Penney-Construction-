const QB_API_BASE = "https://quickbooks.api.intuit.com/v3/company";

/** Run a QuickBooks SQL-like query */
export async function qbQuery<T = Record<string, unknown>>(
  realmId: string,
  accessToken: string,
  query: string
): Promise<T[]> {
  const url = `${QB_API_BASE}/${realmId}/query?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QB query failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const response = data.QueryResponse;

  // QB returns the entity name as the key (Bill, Payment, Vendor, etc.)
  const entityKeys = Object.keys(response).filter((k) => k !== "startPosition" && k !== "maxResults" && k !== "totalCount");
  if (entityKeys.length === 0) return [];

  return response[entityKeys[0]] as T[];
}

/* ── QuickBooks entity types (simplified) ── */

export interface QBBill {
  Id: string;
  VendorRef?: { value: string; name: string };
  TxnDate: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  Line: Array<{
    Amount: number;
    Description?: string;
    AccountBasedExpenseLineDetail?: { AccountRef?: { name: string } };
    ItemBasedExpenseLineDetail?: { ItemRef?: { name: string } };
  }>;
  PrivateNote?: string;
  MetaData?: { CreateTime: string; LastUpdatedTime: string };
}

export interface QBPayment {
  Id: string;
  CustomerRef?: { value: string; name: string };
  TxnDate: string;
  TotalAmt: number;
  UnappliedAmt?: number;
  PaymentMethodRef?: { name: string };
  PrivateNote?: string;
  // Which invoices this payment was applied to in QuickBooks. When present this
  // is the authoritative payment→invoice link — the matcher trusts it over any
  // amount/date heuristic.
  Line?: Array<{
    Amount: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>;
  MetaData?: { CreateTime: string; LastUpdatedTime: string };
}

// A QuickBooks Invoice = money the CLIENT owes Penney (AR). Maps to the app's
// client_invoices table. CustomerRef carries the "Customer:Job" — the Job is the
// project. Balance === 0 means paid; Balance === TotalAmt means fully open.
export interface QBInvoice {
  Id: string;
  DocNumber?: string;
  CustomerRef?: { value: string; name: string };
  TxnDate: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  EmailStatus?: string;
  Line?: Array<{
    Amount?: number;
    Description?: string;
    DetailType?: string;
    SalesItemLineDetail?: { ItemRef?: { value: string; name: string } };
  }>;
  // Payments/credits QuickBooks has already linked to this invoice.
  LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  PrivateNote?: string;
  MetaData?: { CreateTime: string; LastUpdatedTime: string };
}

export interface QBVendor {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  MetaData?: { CreateTime: string; LastUpdatedTime: string };
}

export interface QBPurchase {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  PaymentType: string;
  EntityRef?: { value: string; name: string; type: string };
  AccountRef?: { value: string; name: string };
  Line: Array<{
    Amount: number;
    Description?: string;
    AccountBasedExpenseLineDetail?: { AccountRef?: { name: string } };
  }>;
  PrivateNote?: string;
  MetaData?: { CreateTime: string; LastUpdatedTime: string };
}

/* ── Fetch functions ── */

export async function fetchBills(realmId: string, accessToken: string) {
  return qbQuery<QBBill>(realmId, accessToken, "SELECT * FROM Bill MAXRESULTS 1000");
}

export async function fetchPayments(realmId: string, accessToken: string) {
  return qbQuery<QBPayment>(realmId, accessToken, "SELECT * FROM Payment MAXRESULTS 1000");
}

export async function fetchVendors(realmId: string, accessToken: string) {
  return qbQuery<QBVendor>(realmId, accessToken, "SELECT * FROM Vendor MAXRESULTS 1000");
}

export async function fetchPurchases(realmId: string, accessToken: string) {
  return qbQuery<QBPurchase>(realmId, accessToken, "SELECT * FROM Purchase MAXRESULTS 1000");
}

export async function fetchInvoices(realmId: string, accessToken: string) {
  return qbQuery<QBInvoice>(realmId, accessToken, "SELECT * FROM Invoice MAXRESULTS 1000");
}

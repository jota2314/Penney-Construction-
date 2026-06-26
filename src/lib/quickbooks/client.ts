const QB_API_BASE = "https://quickbooks.api.intuit.com/v3/company";
const QB_API_BASE_SANDBOX = "https://sandbox-quickbooks.api.intuit.com/v3/company";

/** Pick the REST base URL for the active environment ("sandbox" | "production"). */
export function getQBApiBase(environment?: string): string {
  return environment === "sandbox" ? QB_API_BASE_SANDBOX : QB_API_BASE;
}

/** Escape a value for use inside a QuickBooks query string literal. */
function qbEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Run a QuickBooks SQL-like query */
export async function qbQuery<T = Record<string, unknown>>(
  realmId: string,
  accessToken: string,
  query: string,
  baseUrl: string = QB_API_BASE
): Promise<T[]> {
  const url = `${baseUrl}/${realmId}/query?query=${encodeURIComponent(query)}`;

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
  PaymentMethodRef?: { name: string };
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

/* ── Write functions ── */

export interface QBCustomer {
  Id: string;
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillingAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
}

/** App-side customer shape needed to mirror a record into QuickBooks. */
export interface CustomerForQB {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface QBCustomerResult {
  qbId: string;
  created: boolean;
  matchedBy: "email" | "name" | null;
  displayName: string;
}

/**
 * Find a QuickBooks customer by email (preferred) then by display name; create
 * one only if no match. Mirrors the dedup order used elsewhere in the app
 * (see findExistingCustomer in ai-email-engine.ts) so we don't spawn duplicate
 * customers in QB.
 */
export async function findOrCreateQBCustomer(
  realmId: string,
  accessToken: string,
  customer: CustomerForQB,
  baseUrl: string = QB_API_BASE
): Promise<QBCustomerResult> {
  const displayName = `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim();

  // 1. Match by email (strongest signal).
  if (customer.email) {
    const byEmail = await qbQuery<QBCustomer>(
      realmId,
      accessToken,
      `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${qbEscape(customer.email)}'`,
      baseUrl
    );
    if (byEmail.length > 0) {
      return { qbId: byEmail[0].Id, created: false, matchedBy: "email", displayName };
    }
  }

  // 2. Fall back to display-name match.
  if (displayName) {
    const byName = await qbQuery<QBCustomer>(
      realmId,
      accessToken,
      `SELECT * FROM Customer WHERE DisplayName = '${qbEscape(displayName)}'`,
      baseUrl
    );
    if (byName.length > 0) {
      return { qbId: byName[0].Id, created: false, matchedBy: "name", displayName };
    }
  }

  if (!displayName) {
    throw new Error("Customer has no name — cannot create a QuickBooks customer.");
  }

  // 3. Create.
  const payload: Record<string, unknown> = { DisplayName: displayName };
  if (customer.first_name) payload.GivenName = customer.first_name;
  if (customer.last_name) payload.FamilyName = customer.last_name;
  if (customer.email) payload.PrimaryEmailAddr = { Address: customer.email };
  if (customer.phone) payload.PrimaryPhone = { FreeFormNumber: customer.phone };
  if (customer.address || customer.city || customer.state || customer.zip) {
    payload.BillingAddr = {
      ...(customer.address ? { Line1: customer.address } : {}),
      ...(customer.city ? { City: customer.city } : {}),
      ...(customer.state ? { CountrySubDivisionCode: customer.state } : {}),
      ...(customer.zip ? { PostalCode: customer.zip } : {}),
    };
  }

  const res = await fetch(`${baseUrl}/${realmId}/customer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QB create customer failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const created = data.Customer as QBCustomer;
  return { qbId: created.Id, created: true, matchedBy: null, displayName };
}

const QB_API_BASES = {
  production: "https://quickbooks.api.intuit.com/v3/company",
  sandbox: "https://sandbox-quickbooks.api.intuit.com/v3/company",
} as const;

export type QBEnvironment = keyof typeof QB_API_BASES;

/** Run a QuickBooks SQL-like query */
export async function qbQuery<T = Record<string, unknown>>(
  realmId: string,
  accessToken: string,
  query: string,
  environment: QBEnvironment = "production"
): Promise<T[]> {
  const url = `${QB_API_BASES[environment]}/${realmId}/query?query=${encodeURIComponent(query)}`;

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

export async function fetchBills(realmId: string, accessToken: string, environment: QBEnvironment = "production") {
  return qbQuery<QBBill>(realmId, accessToken, "SELECT * FROM Bill MAXRESULTS 1000", environment);
}

export async function fetchPayments(realmId: string, accessToken: string, environment: QBEnvironment = "production") {
  return qbQuery<QBPayment>(realmId, accessToken, "SELECT * FROM Payment MAXRESULTS 1000", environment);
}

export async function fetchVendors(realmId: string, accessToken: string, environment: QBEnvironment = "production") {
  return qbQuery<QBVendor>(realmId, accessToken, "SELECT * FROM Vendor MAXRESULTS 1000", environment);
}

export async function fetchPurchases(realmId: string, accessToken: string, environment: QBEnvironment = "production") {
  return qbQuery<QBPurchase>(realmId, accessToken, "SELECT * FROM Purchase MAXRESULTS 1000", environment);
}

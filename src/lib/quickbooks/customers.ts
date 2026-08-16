import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, isQuickBooksConnected } from "./auth";
import { qbQuery, qbPost, type QBEnvironment } from "./client";

interface QBCustomer {
  Id: string;
  DisplayName: string;
  ParentRef?: { value: string };
}

/** Escape a value for use inside a QuickBooks query string literal */
function qbEscape(value: string) {
  return value.replace(/'/g, "\\'");
}

async function findCustomersByDisplayName(
  realmId: string,
  accessToken: string,
  displayName: string,
  environment: QBEnvironment
): Promise<QBCustomer[]> {
  return qbQuery<QBCustomer>(
    realmId,
    accessToken,
    `SELECT Id, DisplayName, ParentRef FROM Customer WHERE DisplayName = '${qbEscape(displayName)}'`,
    environment
  );
}

async function findCustomerByDisplayName(
  realmId: string,
  accessToken: string,
  displayName: string,
  environment: QBEnvironment
): Promise<QBCustomer | null> {
  return (await findCustomersByDisplayName(realmId, accessToken, displayName, environment))[0] || null;
}

/**
 * Ensure the app customer exists as a QuickBooks Customer and the project as a
 * sub-customer (Job) beneath it — the QuickBooks pattern for job costing.
 * Stores the QuickBooks Ids back on the app rows. Safe to call repeatedly.
 */
export async function pushProjectToQuickBooks(
  projectId: string
): Promise<{ error: string | null; qbJobId?: string }> {
  if (!(await isQuickBooksConnected())) {
    return { error: "QuickBooks not connected" };
  }

  const supabase = createAdminClient();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, name, project_number, address, city, state, zip, quickbooks_customer_id, customer_id, customers(id, first_name, last_name, email, phone, address, quickbooks_customer_id)")
    .eq("id", projectId)
    .single();

  if (projErr || !project) return { error: projErr?.message || "Project not found" };
  if (project.quickbooks_customer_id) {
    return { error: null, qbJobId: project.quickbooks_customer_id };
  }

  const { accessToken, realmId, environment } = await getValidAccessToken();

  // 1. Ensure the client exists as a top-level QuickBooks Customer
  // (customers() is a to-one join; supabase types it as an array)
  const customer = Array.isArray(project.customers) ? project.customers[0] : project.customers;
  let parentQbId: string | null = customer?.quickbooks_customer_id || null;

  if (customer && !parentQbId) {
    const clientName = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
    if (clientName) {
      const existing = await findCustomerByDisplayName(realmId, accessToken, clientName, environment);
      if (existing) {
        parentQbId = existing.Id;
      } else {
        const created = await qbPost<QBCustomer>(realmId, accessToken, "Customer", {
          DisplayName: clientName,
          GivenName: customer.first_name || undefined,
          FamilyName: customer.last_name || undefined,
          PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
          PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
          BillAddr: customer.address ? { Line1: customer.address } : undefined,
        }, environment);
        parentQbId = created.Id;
      }
      await supabase
        .from("customers")
        .update({ quickbooks_customer_id: parentQbId })
        .eq("id", customer.id);
    }
  }

  // 2. Link the project to a QuickBooks job — ADOPT before creating.
  // Nicole/Ryan create QBO Projects named exactly like the app project
  // ("O'Mealia Renovation"), and expenses get coded there. Creating our own
  // "PC-####"-prefixed twin put income and costs on different records for
  // every contracted job (fixed by hand in the 8/16 sweep). So: if a customer
  // with the project's plain name exists, use it; only create when nothing
  // adoptable is found — and then with the plain name too, so a later
  // "convert to project" in QBO keeps the same record.
  const plainName = (project.name || "").trim();
  let jobId: string | null = null;
  let plainNameTaken = false;

  if (plainName) {
    const candidates = await findCustomersByDisplayName(realmId, accessToken, plainName, environment);
    plainNameTaken = candidates.length > 0;
    const adopted =
      candidates.find((c) => parentQbId && c.ParentRef?.value === parentQbId) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (adopted) jobId = adopted.Id;
  }

  if (!jobId) {
    // Same-name customer exists but belongs elsewhere (or name blank):
    // fall back to the project-number-prefixed name for uniqueness.
    const jobName = plainNameTaken || !plainName
      ? [project.project_number, project.name].filter(Boolean).join(" ").trim()
      : plainName;
    const existingJob = await findCustomerByDisplayName(realmId, accessToken, jobName, environment);
    if (existingJob) {
      jobId = existingJob.Id;
    } else {
      const created = await qbPost<QBCustomer>(realmId, accessToken, "Customer", {
        DisplayName: jobName,
        Job: parentQbId ? true : undefined,
        ParentRef: parentQbId ? { value: parentQbId } : undefined,
        // Must be true, and it is not about billing preference.
        // QuickBooks' "Convert sub-customers to projects" tool only lists
        // sub-customers that are active, have no sub-customers of their own,
        // and are "billed to a parent customer" — that last one is this flag.
        // With it false, every job we pushed was silently ineligible and the
        // convert dialog came up empty, which is the only route into Projects
        // at all (there is no Projects API — IsProject is not even a property
        // of Customer; verified against the sandbox).
        BillWithParent: parentQbId ? true : undefined,
        ShipAddr: project.address
          ? {
              Line1: project.address,
              City: project.city || undefined,
              CountrySubDivisionCode: project.state || undefined,
              PostalCode: project.zip || undefined,
            }
          : undefined,
      }, environment);
      jobId = created.Id;
    }
  }

  await supabase
    .from("projects")
    .update({ quickbooks_customer_id: jobId })
    .eq("id", project.id);

  return { error: null, qbJobId: jobId };
}

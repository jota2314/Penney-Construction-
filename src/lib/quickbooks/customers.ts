import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, isQuickBooksConnected } from "./auth";
import { qbQuery, qbPost, type QBEnvironment } from "./client";

interface QBCustomer {
  Id: string;
  DisplayName: string;
}

/** Escape a value for use inside a QuickBooks query string literal */
function qbEscape(value: string) {
  return value.replace(/'/g, "\\'");
}

async function findCustomerByDisplayName(
  realmId: string,
  accessToken: string,
  displayName: string,
  environment: QBEnvironment
): Promise<QBCustomer | null> {
  const rows = await qbQuery<QBCustomer>(
    realmId,
    accessToken,
    `SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${qbEscape(displayName)}'`,
    environment
  );
  return rows[0] || null;
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

  // 2. Create the project as a sub-customer (Job). DisplayName must be unique
  // in QuickBooks, so prefix with the project number.
  const jobName = [project.project_number, project.name].filter(Boolean).join(" ").trim();
  const existingJob = await findCustomerByDisplayName(realmId, accessToken, jobName, environment);

  let jobId: string;
  if (existingJob) {
    jobId = existingJob.Id;
  } else {
    const created = await qbPost<QBCustomer>(realmId, accessToken, "Customer", {
      DisplayName: jobName,
      Job: parentQbId ? true : undefined,
      // A sub-customer alone only shows nested under Customers. IsProject is
      // what puts it on the Projects page, where QuickBooks tracks income,
      // costs and profit per job — which is the whole reason to mirror at all.
      // Requires minorversion >= 59; the client pins one now.
      IsProject: parentQbId ? true : undefined,
      ParentRef: parentQbId ? { value: parentQbId } : undefined,
      BillWithParent: parentQbId ? false : undefined,
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

  await supabase
    .from("projects")
    .update({ quickbooks_customer_id: jobId })
    .eq("id", project.id);

  return { error: null, qbJobId: jobId };
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUO_PROVIDER,
  callWriteFromEvent,
  messageWriteFromEvent,
  phoneKey,
  pickContact,
  pickProject,
  type PhoneDirectoryRow,
  type PhoneLogContact,
  type ProjectCandidate,
  type ProjectMatch,
  type QuoEnvelope,
} from "@/lib/quo/events";

/**
 * Stores one verified Quo event. Texts go to `sms_messages`, calls to
 * `phone_calls` (the tables the Twilio field line created), tagged
 * provider = 'quo' and keyed on Quo's own id so retries and out-of-order
 * deliveries land on the same row.
 *
 * The outside party's number is matched to an employee, client or sub, and a
 * client or sub with exactly one candidate job is filed on that job. Anything
 * else is stored with project_id null for a person to place. Nothing here
 * calls AI, sends a reply or notifies anyone.
 */

type Admin = SupabaseClient;

export type QuoIngestResult =
  | { handled: false; reason: "ignored_event" | "missing_id" }
  | {
      handled: true;
      table: "sms_messages" | "phone_calls";
      outcome: "inserted" | "updated";
    };

type ContactColumns = {
  contact_kind: PhoneLogContact["kind"] | null;
  contact_id: string | null;
  contact_name: string | null;
  project_id: string | null;
  project_match: ProjectMatch | null;
};

const NO_CONTACT: ContactColumns = {
  contact_kind: null,
  contact_id: null,
  contact_name: null,
  project_id: null,
  project_match: null,
};

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

/**
 * People whose stored phone contains this number's last four digits, from
 * the three tables that carry phones. Narrowing in SQL keeps every lookup far
 * under PostgREST's 1,000-row cap; the exact last-10 compare happens in
 * `pickContact`.
 */
async function loadDirectory(
  admin: Admin,
  number: string,
): Promise<PhoneDirectoryRow[]> {
  const key = phoneKey(number);
  if (!key) return [];
  const lastFour = `%${key.slice(-4)}%`;

  const [employees, customers, subs] = await Promise.all([
    admin
      .from("employees")
      .select("id, first_name, last_name, phone")
      .ilike("phone", lastFour),
    admin
      .from("customers")
      .select("id, first_name, last_name, phone")
      .ilike("phone", lastFour),
    admin
      .from("subcontractors")
      .select("id, company_name, contact_name, phone")
      .ilike("phone", lastFour),
  ]);

  for (const result of [employees, customers, subs]) {
    if (result.error) throw new Error(result.error.message);
  }

  type Person = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  };
  type Sub = {
    id: string;
    company_name: string | null;
    contact_name: string | null;
    phone: string | null;
  };

  return [
    ...((employees.data as Person[] | null) ?? []).map((row) => ({
      kind: "employee" as const,
      id: row.id,
      name: fullName(row.first_name, row.last_name) || "Employee",
      phone: row.phone,
    })),
    ...((customers.data as Person[] | null) ?? []).map((row) => ({
      kind: "customer" as const,
      id: row.id,
      name: fullName(row.first_name, row.last_name) || "Client",
      phone: row.phone,
    })),
    ...((subs.data as Sub[] | null) ?? []).map((row) => ({
      kind: "subcontractor" as const,
      id: row.id,
      name: row.contact_name || row.company_name || "Subcontractor",
      phone: row.phone,
    })),
  ];
}

async function loadProjects(
  admin: Admin,
  contact: PhoneLogContact,
): Promise<ProjectCandidate[]> {
  if (contact.kind === "employee") return [];

  const projectIds = new Set<string>();
  const candidates: ProjectCandidate[] = [];

  if (contact.kind === "customer") {
    const [direct, linked] = await Promise.all([
      admin
        .from("projects")
        .select("id, status, is_overhead")
        .eq("customer_id", contact.id),
      admin
        .from("project_customers")
        .select("project_id")
        .eq("customer_id", contact.id),
    ]);
    if (direct.error) throw new Error(direct.error.message);
    if (linked.error) throw new Error(linked.error.message);
    candidates.push(...((direct.data as ProjectCandidate[] | null) ?? []));
    for (const row of (linked.data as { project_id: string }[] | null) ?? []) {
      projectIds.add(row.project_id);
    }
  } else {
    const { data, error } = await admin
      .from("project_subcontractors")
      .select("project_id")
      .eq("subcontractor_id", contact.id);
    if (error) throw new Error(error.message);
    for (const row of (data as { project_id: string }[] | null) ?? []) {
      projectIds.add(row.project_id);
    }
  }

  const known = new Set(candidates.map((candidate) => candidate.id));
  const missing = [...projectIds].filter((id) => !known.has(id));
  if (missing.length > 0) {
    const { data, error } = await admin
      .from("projects")
      .select("id, status, is_overhead")
      .in("id", missing);
    if (error) throw new Error(error.message);
    candidates.push(...((data as ProjectCandidate[] | null) ?? []));
  }

  return candidates;
}

/** Who the outside number is, and the one job it can safely be filed on. */
async function resolveContactColumns(
  admin: Admin,
  counterparts: string[],
): Promise<ContactColumns> {
  // A group text can carry several numbers; a handful is plenty.
  for (const number of counterparts.slice(0, 5)) {
    const contact = pickContact([number], await loadDirectory(admin, number));
    if (!contact) continue;

    if (contact.kind === "employee") {
      return {
        ...NO_CONTACT,
        contact_kind: contact.kind,
        contact_id: contact.id,
        contact_name: contact.name,
      };
    }

    const { projectId, match } = pickProject(
      await loadProjects(admin, contact),
    );
    return {
      contact_kind: contact.kind,
      contact_id: contact.id,
      contact_name: contact.name,
      project_id: projectId,
      project_match: match,
    };
  }
  return NO_CONTACT;
}

/**
 * Update the row if we already have it, otherwise create it. Update comes
 * first so an event for a row someone already re-filed by hand never touches
 * its contact or job, and so repeats skip the directory lookups entirely.
 */
async function updateOrInsert(args: {
  admin: Admin;
  table: "sms_messages" | "phone_calls";
  externalId: string;
  patch: Record<string, unknown>;
  buildRow: () => Promise<Record<string, unknown>>;
}): Promise<"inserted" | "updated"> {
  const { admin, table, externalId, patch, buildRow } = args;

  const update = async (): Promise<boolean> => {
    if (Object.keys(patch).length === 0) {
      const { data, error } = await admin
        .from(table)
        .select("id")
        .eq("provider", QUO_PROVIDER)
        .eq("external_id", externalId)
        .limit(1);
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    }
    const { data, error } = await admin
      .from(table)
      .update(patch)
      .eq("provider", QUO_PROVIDER)
      .eq("external_id", externalId)
      .select("id");
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  };

  if (await update()) return "updated";

  const { data, error } = await admin
    .from(table)
    .upsert(
      { ...(await buildRow()), ...patch },
      { onConflict: "provider,external_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(error.message);
  if ((data?.length ?? 0) > 0) return "inserted";

  // Another event for the same call or text created the row between our
  // update and our insert. Apply this event's columns to it.
  await update();
  return "updated";
}

export async function ingestQuoEvent(
  admin: Admin,
  event: QuoEnvelope,
): Promise<QuoIngestResult> {
  if (event.type.startsWith("message.")) {
    const write = messageWriteFromEvent(event);
    if (!write) {
      return {
        handled: false,
        reason: event.resource.id ? "ignored_event" : "missing_id",
      };
    }
    const outcome = await updateOrInsert({
      admin,
      table: "sms_messages",
      externalId: write.externalId,
      patch: write.patch,
      buildRow: async () => ({
        ...write.row,
        ...(await resolveContactColumns(admin, write.counterparts)),
      }),
    });
    return { handled: true, table: "sms_messages", outcome };
  }

  if (event.type.startsWith("call.")) {
    const write = callWriteFromEvent(event);
    if (!write) return { handled: false, reason: "ignored_event" };
    const outcome = await updateOrInsert({
      admin,
      table: "phone_calls",
      externalId: write.externalId,
      patch: write.patch,
      buildRow: async () => ({
        ...write.stub,
        ...(await resolveContactColumns(admin, write.counterparts)),
      }),
    });
    return { handled: true, table: "phone_calls", outcome };
  }

  return { handled: false, reason: "ignored_event" };
}

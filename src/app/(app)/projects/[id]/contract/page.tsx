import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import { ContractBuilder } from "@/components/projects/contract-builder";

export const metadata: Metadata = { title: "Contract | Penney Construction" };

// Contract-first flow: open the contract, set the payment schedule as part
// of it, generate the PDF at the end. The schedule saves to
// project_payment_milestones, so Finances one-click invoicing stays in sync.
export default async function ProjectContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: estimates }, { data: milestones }, { data: clientInvoices }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, project_number, address, city, state, zip, contract_value, estimated_value, customers(first_name, last_name, email)")
        .eq("id", id)
        .single(),
      supabase
        .from("estimates")
        .select("id, version, total_price")
        .eq("project_id", id)
        .in("status", ["approved", "draft"])
        .order("version", { ascending: false })
        .limit(1),
      supabase
        .from("project_payment_milestones")
        .select("id, sort_order, label, stage_key, percent, amount, status, client_invoice_id")
        .eq("project_id", id)
        .order("sort_order"),
      supabase
        .from("client_invoices")
        .select("id, invoice_number, status, paid_at")
        .eq("project_id", id),
    ]);

  if (!project) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const custArr = project.customers as any;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const latestEstimate = estimates?.[0] ?? null;

  const basis =
    Number(project.contract_value ?? 0) ||
    Number(latestEstimate?.total_price ?? 0) ||
    Number(project.estimated_value ?? 0);
  const basisSource = project.contract_value
    ? "contract value"
    : latestEstimate
      ? `estimate v${latestEstimate.version}`
      : "estimated value";

  return (
    <>
      <Header title="Contract" backHref={`/projects/${id}`} backLabel="Project" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
        <Link
          href={`/projects/${id}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          {project.project_number} — {project.name}
        </Link>

        <ContractBuilder
          projectId={id}
          projectName={project.name}
          projectNumber={project.project_number ?? ""}
          clientName={cust ? `${cust.first_name} ${cust.last_name}` : ""}
          projectAddress={[project.address, project.city, project.state || "MA", project.zip].filter(Boolean).join(", ")}
          basis={basis}
          basisSource={basisSource}
          hasEstimate={!!latestEstimate}
          milestones={milestones ?? []}
          clientInvoices={clientInvoices ?? []}
        />
      </div>
    </>
  );
}

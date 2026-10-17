import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSignSubAgreements } from "@/lib/auth/role-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEMPLATE_COLUMNS, isAgreementOfficeRole, toSections, type TemplateRow } from "@/lib/subs/agreements";
import { AgreementTemplates } from "@/components/subcontractors/agreement-templates";

export const metadata: Metadata = { title: "Sub agreements | Penney Construction" };
export const dynamic = "force-dynamic";

/**
 * The agreement text Ryan approves (ADDENDUM 2): the master subcontract
 * agreement, the work order terms and the sub change order terms. Claude
 * drafted them with "[FILL IN: ...]" blanks; Ryan reads each section, fills
 * the business blanks and taps Approve. Until then every agreement PDF says
 * DRAFT and Send stays locked.
 */
export default async function SubAgreementsPage() {
  const user = await requireAuth();
  const role = user.profile?.role ?? null;
  const admin = createAdminClient();
  const { data } = isAgreementOfficeRole(role)
    ? await admin.from("sub_agreement_templates").select(TEMPLATE_COLUMNS).order("kind").order("version", { ascending: false })
    : { data: [] };
  const templates: TemplateRow[] = (data ?? []).map((t) => ({ ...(t as TemplateRow), sections: toSections(t.sections), test_only: !!t.test_only }));

  return (
    <>
      <Header title="Sub agreements" backHref="/subcontractors" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        {isAgreementOfficeRole(role) ? (
          <AgreementTemplates
            templates={templates}
            viewer={{
              canApprove: canSignSubAgreements(user),
              canEdit: role === "owner" || role === "precon_manager",
              name: user.realProfile?.full_name ?? user.email,
              impersonating: !!user.isImpersonating,
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Office staff only.</p>
        )}
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getSurvey, getSurveyPickerData } from "@/lib/actions/surveys";
import { SurveyBuilder } from "@/components/surveys/survey-builder";

export const metadata: Metadata = { title: "Edit Survey | Penney Construction" };

export default async function EditSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const [data, pickers] = await Promise.all([getSurvey(id), getSurveyPickerData()]);
  if (!data) notFound();

  return (
    <>
      <Header title="Edit survey" subtitle={data.survey.title} backHref={`/surveys/${id}`} backLabel="Results" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <SurveyBuilder survey={data.survey} projects={pickers.projects} customers={pickers.customers} />
      </div>
    </>
  );
}

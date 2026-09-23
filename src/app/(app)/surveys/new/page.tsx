import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getSurveyPickerData } from "@/lib/actions/surveys";
import { SurveyBuilder } from "@/components/surveys/survey-builder";

export const metadata: Metadata = { title: "New Survey | Penney Construction" };

export default async function NewSurveyPage() {
  await requireAuth();
  const { projects, customers } = await getSurveyPickerData();

  return (
    <>
      <Header title="New survey" backHref="/surveys" backLabel="Surveys" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <SurveyBuilder projects={projects} customers={customers} />
      </div>
    </>
  );
}

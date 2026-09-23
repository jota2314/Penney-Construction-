import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { listSurveys } from "@/lib/actions/surveys";
import { SurveyList } from "@/components/surveys/survey-list";

export const metadata: Metadata = { title: "Surveys | Penney Construction" };

export default async function SurveysPage() {
  await requireAuth();
  const surveys = await listSurveys();

  return (
    <>
      <Header title="Surveys" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <SurveyList surveys={surveys} />
      </div>
    </>
  );
}

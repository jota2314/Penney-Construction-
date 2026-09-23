import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getSurvey } from "@/lib/actions/surveys";
import { SurveyResults } from "@/components/surveys/survey-results";

export const metadata: Metadata = { title: "Survey | Penney Construction" };

export default async function SurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const data = await getSurvey(id);
  if (!data) notFound();

  return (
    <>
      <Header title={data.survey.title} subtitle="Survey" backHref="/surveys" backLabel="Surveys" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <SurveyResults
          survey={data.survey}
          responses={data.responses}
          project={data.project}
          customer={data.customer}
        />
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { ApplyForm } from "@/components/hiring/apply-form";

export const metadata: Metadata = {
  title: "Join Penney Construction",
  description:
    "Apply to join the Penney Construction team — Project Coordinator and AI Operations roles.",
};

const VALID_ROLES = new Set(["coordinator", "ai_ops"]);

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  const initialRole =
    role && VALID_ROLES.has(role) ? (role as "coordinator" | "ai_ops") : null;

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-16">
        <ApplyForm initialRole={initialRole} />
      </div>
    </main>
  );
}

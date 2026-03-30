import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTodos } from "@/lib/actions/command-center";
import { TodosList } from "@/components/command-center/todos-list";

export const metadata: Metadata = { title: "Todos | Penney Construction" };

export default async function TodosPage() {
  await requireAuth();

  let todos = await getTodos().catch(() => []);

  return (
    <>
      <Header title="Todos" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 min-w-0 overflow-auto">
        <TodosList todos={todos} />
      </div>
    </>
  );
}

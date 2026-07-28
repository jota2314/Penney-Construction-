import { notFound } from "next/navigation";
import { TodosList } from "@/components/eos/todos-list";
import { getEosContext, listTodos } from "@/lib/eos/queries";

export default async function EosTodosPage() {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const todos = await listTodos(ctx);

  return <TodosList todos={todos} people={ctx.people} />;
}

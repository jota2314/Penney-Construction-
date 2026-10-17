import "server-only";
import { revalidatePath } from "next/cache";

/** Every schedule writer invalidates the same readers, including public previews. */
export function revalidateSchedule(projectId: string) {
  for (const path of [`/projects/${projectId}`, "/projects", "/schedule", "/board", "/crew", "/command-center"]) {
    revalidatePath(path);
  }
  revalidatePath("/portal/[token]", "page");
  revalidatePath("/sub-portal/[token]", "page");
}

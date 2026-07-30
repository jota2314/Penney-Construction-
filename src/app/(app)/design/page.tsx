import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Bath } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAuth } from "@/lib/auth/require-auth";
import { canViewDesignStudio } from "@/lib/auth/role-access";
import { listDesigns, createDesign } from "@/lib/actions/design";

export const metadata: Metadata = { title: "Design Studio | Penney Construction" };

/**
 * Private design studio index.
 *
 * Returns a 404 rather than redirecting — someone who shouldn't be here gets no
 * signal that the route exists at all. Middleware blocks /design for anyone off
 * the allowlist before this even runs; this is the second layer, and RLS is the
 * third.
 */
export default async function DesignIndexPage() {
  const user = await requireAuth();
  if (!canViewDesignStudio(user.profile?.email ?? user.email)) notFound();

  const designs = await listDesigns();

  return (
    <>
      <Header title="Design Studio" subtitle="Private" />

      <div className="p-4 space-y-6 max-w-5xl">
        <Card className="p-4">
          <form action={createDesign} className="flex flex-col sm:flex-row gap-2">
            <Input name="name" placeholder="Bathroom name" className="sm:max-w-xs" required />
            <Input
              name="projectLabel"
              placeholder="Job reference (optional)"
              className="sm:max-w-xs"
            />
            <Button type="submit" className="sm:ml-auto">
              <Plus className="h-4 w-4 mr-1" />
              New design
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2">
            A sandbox. Nothing here touches a project, an estimate, or anything a client sees.
          </p>
        </Card>

        {designs.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            <Bath className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="font-medium text-foreground mb-1">Nothing here yet</p>
            <p>Name a bathroom above, then send a photo and the measurements.</p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {designs.map((d) => (
              <Link key={d.id} href={`/design/${d.id}`}>
                <Card className="overflow-hidden hover:border-primary/50 transition-colors h-full">
                  <div className="aspect-[3/2] bg-muted relative">
                    {d.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.thumbnailUrl}
                        alt={d.name}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                        <Bath className="h-7 w-7 opacity-40" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="font-medium text-sm truncate">{d.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {d.projectLabel ? `${d.projectLabel} · ` : ""}v{d.version} ·{" "}
                      {new Date(d.updatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

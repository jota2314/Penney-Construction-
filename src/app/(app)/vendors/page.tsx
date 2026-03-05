import { Header } from "@/components/layout/header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Store } from "lucide-react";

export default function VendorsPage() {
  return (
    <>
      <Header title="Vendors" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              <CardTitle>Vendors</CardTitle>
            </div>
            <CardDescription>
              Manage your vendor database. Track suppliers, lumber yards, and
              material sources.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Vendor management is coming soon. You&apos;ll be able to maintain
              a master vendor list and assign vendors to individual projects.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

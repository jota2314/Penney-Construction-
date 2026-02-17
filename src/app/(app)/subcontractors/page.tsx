import { Header } from "@/components/layout/header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HardHat } from "lucide-react";

export default function SubcontractorsPage() {
  return (
    <>
      <Header title="Subcontractors" />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <HardHat className="h-5 w-5" />
              <CardTitle>Subcontractors</CardTitle>
            </div>
            <CardDescription>
              Manage your subcontractor database. Track trades, ratings, and bid
              history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Subcontractor management coming in Phase 5. You&apos;ll be able to
              manage your sub database, create bid packages, and track bids.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

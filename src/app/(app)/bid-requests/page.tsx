import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Send } from "lucide-react";

export const metadata: Metadata = { title: "Bid Requests | Penney Construction" };

export default function BidRequestsPage() {
  return (
    <>
      <Header title="Bid Requests" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              <CardTitle>Bid Requests</CardTitle>
            </div>
            <CardDescription>
              Send bid requests to subcontractors and track their responses.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Bid requests coming in Phase 5. You&apos;ll be able to create bid
              packages, send them to subs, and compare bids side by side.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

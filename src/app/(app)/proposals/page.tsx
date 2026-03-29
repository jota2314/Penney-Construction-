import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileText } from "lucide-react";

export const metadata: Metadata = { title: "Proposals | Penney Construction" };

export default function ProposalsPage() {
  return (
    <>
      <Header title="Proposals" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <CardTitle>Proposals</CardTitle>
            </div>
            <CardDescription>
              Create professional customer proposals and export them as PDFs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Customer proposals coming in Phase 4. You&apos;ll be able to
              generate polished proposals from your estimates and send them to
              customers.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

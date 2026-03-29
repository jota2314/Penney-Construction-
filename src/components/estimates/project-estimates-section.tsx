"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, Calculator } from "lucide-react";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { EstimateFormDialog } from "./estimate-form-dialog";
import { EstimateDeleteDialog } from "./estimate-delete-dialog";
import { formatCurrency } from "@/lib/utils";
import type { Estimate, ProjectType } from "@/types/database";

interface ProjectEstimatesSectionProps {
  projectId: string;
  projectType: ProjectType;
  estimates: Estimate[];
}

export function ProjectEstimatesSection({
  projectId,
  projectType,
  estimates,
}: ProjectEstimatesSectionProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editEstimate, setEditEstimate] = useState<Estimate | null>(null);
  const [deleteEst, setDeleteEst] = useState<Estimate | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            <CardTitle className="text-base">Estimates</CardTitle>
          </div>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Estimate
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {estimates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No estimates yet. Create one to start building your budget.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Version</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="hidden md:table-cell w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {estimates.map((est) => (
                  <TableRow key={est.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/projects/${projectId}/estimates/${est.id}`}
                        className="hover:underline"
                      >
                        {est.name}
                      </Link>
                      <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                        v{est.version} · <EstimateStatusBadge status={est.status} />
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">v{est.version}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <EstimateStatusBadge status={est.status} />
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(est.total_price)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditEstimate(est)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteEst(est)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <EstimateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId}
        projectType={projectType}
      />

      {editEstimate && (
        <EstimateFormDialog
          open={!!editEstimate}
          onOpenChange={(open) => {
            if (!open) setEditEstimate(null);
          }}
          projectId={projectId}
          estimate={editEstimate}
        />
      )}

      {deleteEst && (
        <EstimateDeleteDialog
          open={!!deleteEst}
          onOpenChange={(open) => {
            if (!open) setDeleteEst(null);
          }}
          estimate={deleteEst}
        />
      )}
    </Card>
  );
}

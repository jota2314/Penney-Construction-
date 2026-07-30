"use client";

/**
 * Selections sheet on screen.
 *
 * The same finish schedule the PDF prints. Its real job is the bottom half:
 * every surface with nothing chosen against it, so the list of decisions still
 * owed is visible rather than discovered at ordering.
 */

import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RoomSpec } from "@/types/design";
import { buildSelections } from "@/lib/design/selections";

export function SelectionsPanel({ spec }: { spec: RoomSpec }) {
  const { rows, open } = buildSelections(spec);

  return (
    <div className="space-y-3">
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr className="text-left">
              <Th>Location</Th>
              <Th>Product</Th>
              <Th>Size</Th>
              <Th>Pattern</Th>
              <Th>Grout</Th>
              <Th>Finish</Th>
              <Th>Order</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={`border-t ${r.missing ? "text-amber-600" : ""}`}
              >
                <Td>{r.location}</Td>
                <Td className="font-medium">{r.product}</Td>
                <Td>{r.size}</Td>
                <Td className="capitalize">{r.pattern}</Td>
                <Td>{r.grout}</Td>
                <Td className="capitalize">{r.finish}</Td>
                <Td>
                  {r.orderSf ? (
                    <span className="whitespace-nowrap">
                      {r.orderSf} SF{r.pieces ? ` / ${r.pieces} pc` : ""}
                    </span>
                  ) : (
                    ""
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {open.length > 0 && (
        <Card className="p-3 border-amber-500/50 bg-amber-500/5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 mb-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Still to select ({open.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {open.map((o, i) => (
              <Badge key={i} variant="outline" className="text-[11px]">
                {o}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground">
        Order quantities include waste and are listed once per product, against its largest
        surface. Concept stage — field-measure before ordering.
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 align-top ${className}`}>{children}</td>;
}

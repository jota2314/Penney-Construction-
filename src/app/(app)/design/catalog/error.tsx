"use client";
import { Button } from "@/components/ui/button";
export default function CatalogError({ reset }: { reset: () => void }) { return <div className="p-8 space-y-4"><h1 className="text-lg font-semibold">Catalog temporarily unavailable</h1><p className="text-muted-foreground">Your designs are unchanged. Please try loading the catalog again.</p><Button onClick={reset}>Try again</Button></div>; }

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { savePortalAssignment } from "@/lib/actions/portal-assignment";
import { priceFreeScopeText } from "@/lib/site-qr/scope-text";

export type PortalAssignment = { id: string; company: string; scope: string | null; updatedAt: string };

export function PortalAssignments({ projectId, assignments }: { projectId: string; assignments: PortalAssignment[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PortalAssignment | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const preview = priceFreeScopeText(text);
  if (!assignments.length) return null;

  async function save() {
    if (!editing || saving || conflict) return;
    setSaving(true);
    setError("");
    try {
      const result = await savePortalAssignment({ projectId, rosterId: editing.id, updatedAt: editing.updatedAt, text });
      if (result.error) {
        setError(result.error);
        if (result.conflict) { setConflict(true); router.refresh(); }
        return;
      }
      setNotice(preview ? `Published the job assignment for ${editing.company}.` : `Removed the job assignment for ${editing.company}.`);
      setEditing(null);
      router.refresh();
    } catch {
      setError("Could not confirm the save. Reopen the assignment to check its latest version.");
      setConflict(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Sub portal assignments">
      <h3 className="font-semibold">Sub portal assignments</h3>
      <ul className="divide-y">
        {assignments.map(row => (
          <li key={row.id} className="flex items-start justify-between gap-4 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{row.company}</p>
              <p className="line-clamp-2 whitespace-pre-line break-words text-sm text-muted-foreground">{priceFreeScopeText(row.scope) || "No job assignment published"}</p>
            </div>
            <Button variant="outline" size="sm" aria-label={`Edit assignment for ${row.company}`} onClick={() => {
              setEditing(row); setText(row.scope || ""); setConflict(false); setError(""); setNotice("");
            }}><Pencil className="size-3.5" />Edit</Button>
          </li>
        ))}
      </ul>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      <Dialog open={!!editing} onOpenChange={open => { if (!open && !saving) setEditing(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Job assignment for {editing?.company}</DialogTitle>
            <DialogDescription>These instructions appear in the job brief when this company opens the job in its sub portal.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="field-assignment">Field instructions</Label>
            <Textarea id="field-assignment" rows={5} value={text} maxLength={4000} disabled={saving}
              onChange={event => setText(event.target.value)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-sm font-medium">Sub portal preview</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm">{preview || "No job assignment published"}</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>Close</Button>
            <Button disabled={saving || conflict || text === (editing?.scope || "") || (!!text.trim() && !preview)} onClick={save}>
              {saving ? "Saving…" : preview ? "Publish assignment" : "Remove assignment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

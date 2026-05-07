"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList,
  Camera,
  CheckCircle,
  X,
  Trash2,
  ImageIcon,
  Plus,
} from "lucide-react";
import {
  createPunchListItem,
  deletePunchListItem,
  getPunchListPhotoUrl,
} from "@/lib/actions/punch-list";
import { VoiceToNotes, useLiveVoiceTextarea } from "@/components/ui/voice-to-notes";
import { PunchListVoiceComposer } from "@/components/projects/punch-list-voice-composer";
import { completeCrewTask } from "@/lib/actions/crew-tasks";
import { createClient } from "@/lib/supabase/client";
import type { Todo } from "@/types/database";

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

interface Props {
  projectId: string;
  projectName: string;
  items: Todo[];
  employees: { id: string; first_name: string; last_name: string; title: string | null }[];
}

export function ProjectPunchListTab({
  projectId,
  projectName,
  items,
  employees,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);

  const open = items.filter((t) => t.status === "open");
  const done = items.filter((t) => t.status === "done");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-amber-500" />
          <div>
            <h2 className="text-lg font-semibold">Punch List</h2>
            <p className="text-xs text-muted-foreground">
              {open.length} open · {done.length} done
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
          className="bg-amber-600 hover:bg-amber-700 text-white gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Item
        </Button>
      </div>

      <PunchListVoiceComposer projectId={projectId} projectName={projectName} />

      {showCreate && (
        <CreatePunchListForm
          projectId={projectId}
          projectName={projectName}
          employees={employees}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Open items */}
      {open.length > 0 && (
        <div className="space-y-2">
          {open.map((item) => (
            <PunchListCard
              key={item.id}
              item={item}
              projectId={projectId}
            />
          ))}
        </div>
      )}

      {open.length === 0 && !showCreate && (
        <div className="rounded-lg border border-dashed bg-card/50 p-8 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No punch list items yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Add items as you walk the job — assign to a worker, require a
            photo on completion.
          </p>
        </div>
      )}

      {/* Done items */}
      {done.length > 0 && (
        <div className="pt-4 border-t">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Completed ({done.length})
          </h3>
          <div className="space-y-2">
            {done.map((item) => (
              <CompletedPunchListCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Open item card with inline complete-with-photo ───────────────

function PunchListCard({
  item,
  projectId,
}: {
  item: Todo;
  projectId: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `field-reports/punch-list/${item.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage
        .from("project-files")
        .upload(path, file, { contentType: file.type });
      if (error) throw error;
      const { data: urlData } = await supabase.storage
        .from("project-files")
        .createSignedUrl(path, 3600);
      setPhotoPath(path);
      setPhotoUrl(urlData?.signedUrl || null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleComplete() {
    if (!photoPath) {
      alert("A photo is required to mark a punch list item done.");
      return;
    }
    setCompleting(true);
    try {
      const result = await completeCrewTask(item.id, note || undefined, photoPath);
      if (result.error) {
        alert(result.error);
      } else {
        router.refresh();
      }
    } finally {
      setCompleting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this punch list item?")) return;
    setDeleting(true);
    try {
      await deletePunchListItem(item.id, projectId);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  const isOverdue =
    item.due_date && item.due_date.split("T")[0] < new Date().toISOString().split("T")[0];

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 text-left flex items-start gap-3 hover:bg-muted/30 transition-colors"
      >
        <div className="mt-1 h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{item.description}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={`text-[10px] ${PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.medium}`}
            >
              {item.priority.toUpperCase()}
            </Badge>
            {item.assignee && (
              <Badge variant="outline" className="text-[10px]">
                → {item.assignee}
              </Badge>
            )}
            {item.due_date && (
              <span
                className={`text-xs ${isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"}`}
              >
                Due {new Date(item.due_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t pt-3">
          {/* Photo (required) */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Completion photo <span className="text-red-400">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            {photoUrl ? (
              <div className="relative h-24 w-24 rounded-lg overflow-hidden">
                <img
                  src={photoUrl}
                  alt="Completion"
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => {
                    setPhotoUrl(null);
                    setPhotoPath(null);
                  }}
                  className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-9 gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Camera className="h-3.5 w-3.5" />
                {uploading ? "Uploading..." : "Take / Upload Photo"}
              </Button>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Note (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was done, anything to flag..."
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleComplete}
              disabled={completing || !photoPath}
              className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle className="h-4 w-4 mr-1.5" />
              {completing ? "Saving..." : "Mark Done"}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleDelete}
              disabled={deleting}
              className="h-10 w-10 text-red-400 hover:text-red-500 hover:bg-red-500/10"
              title="Delete item"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Completed item card with photo thumbnail ─────────────────────

function CompletedPunchListCard({ item }: { item: Todo }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);

  async function loadPhoto() {
    if (!item.completion_photo_path || photoUrl) {
      setShowPhoto(true);
      return;
    }
    const url = await getPunchListPhotoUrl(item.completion_photo_path);
    setPhotoUrl(url);
    setShowPhoto(true);
  }

  return (
    <div className="rounded-lg border bg-card/50 p-3 opacity-90">
      <div className="flex items-start gap-3">
        <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm line-through decoration-muted-foreground/40">
            {item.description}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
            {item.completed_at && (
              <span>
                Done {new Date(item.completed_at).toLocaleDateString()}
              </span>
            )}
            {item.assignee && <span>· by {item.assignee}</span>}
            {item.completion_photo_path && (
              <button
                onClick={loadPhoto}
                className="text-amber-500 hover:text-amber-400 font-medium gap-1 inline-flex items-center"
              >
                <ImageIcon className="h-3 w-3" />
                Photo
              </button>
            )}
          </div>
          {item.completion_note && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              &ldquo;{item.completion_note}&rdquo;
            </p>
          )}
          {showPhoto && photoUrl && (
            <div className="mt-2 rounded-lg overflow-hidden max-w-xs">
              <img
                src={photoUrl}
                alt="Completion"
                className="w-full h-auto cursor-pointer"
                onClick={() => window.open(photoUrl, "_blank")}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────

function CreatePunchListForm({
  projectId,
  projectName,
  employees,
  onClose,
}: {
  projectId: string;
  projectName: string;
  employees: { id: string; first_name: string; last_name: string; title: string | null }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState("");
  const live = useLiveVoiceTextarea(description, setDescription);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const onPickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = 10 - photoFiles.length;
    const accepted = files.slice(0, Math.max(0, remaining));
    const previews = accepted.map((f) => URL.createObjectURL(f));
    setPhotoFiles((prev) => [...prev, ...accepted]);
    setPhotoPreviews((prev) => [...prev, ...previews]);
    e.target.value = "";
  };

  const removePhoto = (idx: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData(e.currentTarget);
      formData.set("project_id", projectId);
      formData.set("project_name", projectName);

      // Upload any attached photos to the project-files bucket BEFORE
      // we create the row, so the storage paths can be saved with it.
      // Foreground upload here is fine — the form is small (≤10 photos)
      // and the user is waiting on this single action to complete.
      if (photoFiles.length > 0) {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in");
        const paths: string[] = [];
        for (const file of photoFiles) {
          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const path = `${projectId}/punch-list/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("project-files")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
          paths.push(path);
        }
        formData.set("creation_photo_paths", paths.join(","));
      }

      await createPunchListItem(formData);
      // Free the object-URLs we generated for the previews.
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
      onClose();
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-card p-4 space-y-3"
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-medium text-muted-foreground">
            What needs to be done? *
          </label>
          <span onClick={live.recording ? undefined : live.startRecording}>
            <VoiceToNotes
              context="punch-list"
              label="Voice"
              onResult={live.onResult}
              onLiveTranscript={live.onLive}
            />
          </span>
        </div>
        {live.recording && (
          <div className="h-0.5 mb-1 rounded-full bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-pulse" />
        )}
        <textarea
          name="description"
          required
          rows={3}
          autoFocus
          value={live.display}
          onChange={(e) => setDescription(e.target.value)}
          readOnly={live.recording}
          className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            live.recording
              ? "border-amber-500/50 bg-amber-500/5 ring-amber-500/30"
              : "bg-background focus:ring-amber-500"
          }`}
          placeholder='e.g. "Patch nail pop above closet door" — or hit Voice and dictate a list'
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Room / Area
          </label>
          <input
            name="location"
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            placeholder="Master bath"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Priority
          </label>
          <select
            name="priority"
            defaultValue="medium"
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Assign to
          </label>
          <select
            name="assignee"
            defaultValue=""
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.first_name}>
                {e.first_name} {e.last_name}
                {e.title ? ` (${e.title})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Due date
          </label>
          <input
            type="date"
            name="due_date"
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Photos {photoFiles.length > 0 && <span className="text-zinc-500">({photoFiles.length}/10)</span>}
        </label>
        <div className="mt-1 flex flex-wrap items-start gap-2">
          {photoPreviews.map((url, i) => (
            <div key={url} className="relative h-16 w-16 overflow-hidden rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {photoFiles.length < 10 && (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="inline-flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-zinc-700 text-zinc-400 hover:border-amber-500/50 hover:text-amber-500"
              aria-label="Add photos"
            >
              <Camera className="h-5 w-5" />
            </button>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPickPhotos}
            className="hidden"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saving}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          {saving ? "Adding..." : "Add to Punch List"}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  Camera,
  ClipboardList,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { completeCrewTask } from "@/lib/actions/crew-tasks";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface Todo {
  id: string;
  description: string;
  priority: string;
  category: string;
  contact_name: string;
  assignee: string | null;
  due_date: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-500 text-white",
};

interface CrewTasksPanelProps {
  tasks: Todo[];
  projectId: string;
}

export function CrewTasksPanel({ tasks, projectId }: CrewTasksPanelProps) {
  const router = useRouter();

  if (tasks.length === 0) return null;

  // Punch list items render in their own group at the top — they
  // require a photo on completion, so workers should see them clearly
  // separated from regular task assignments.
  const punchList = tasks.filter((t) => t.category === "punch_list");
  const otherTasks = tasks.filter((t) => t.category !== "punch_list");

  return (
    <div className="space-y-4">
      {punchList.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-rose-500" />
            <h3 className="text-sm font-semibold">
              Punch List ({punchList.length})
            </h3>
            <span className="text-[10px] text-muted-foreground">
              · photo required
            </span>
          </div>
          {punchList.map((task) => (
            <CrewTaskCard
              key={task.id}
              task={task}
              projectId={projectId}
              onCompleted={() => router.refresh()}
            />
          ))}
        </div>
      )}

      {otherTasks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">
              Tasks ({otherTasks.length})
            </h3>
          </div>
          {otherTasks.map((task) => (
            <CrewTaskCard
              key={task.id}
              task={task}
              projectId={projectId}
              onCompleted={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CrewTaskCard({
  task,
  projectId,
  onCompleted,
}: {
  task: Todo;
  projectId: string;
  onCompleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
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
      const path = `field-reports/tasks/${task.id}/${Date.now()}-${file.name}`;

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

  const isPunchList = task.category === "punch_list";
  const photoRequired = isPunchList;
  const canComplete = !photoRequired || !!photoPath;

  async function handleComplete() {
    if (photoRequired && !photoPath) {
      alert("Punch list items need a photo before they can be marked done.");
      return;
    }
    setCompleting(true);
    try {
      const result = await completeCrewTask(
        task.id,
        note || undefined,
        photoPath || undefined
      );
      if (result.error) {
        alert(result.error);
      } else {
        onCompleted();
      }
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Task header — tap to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 text-left flex items-start gap-3"
      >
        <div className="mt-0.5 h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{task.description}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge
              className={`text-[10px] ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium}`}
            >
              {task.priority}
            </Badge>
            {task.due_date && (
              <span className="text-xs text-muted-foreground">
                Due: {new Date(task.due_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded: complete with photo + note */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t pt-3">
          {photoRequired && !photoPath && (
            <p className="text-xs text-rose-400 -mb-1">
              Photo required for punch list items.
            </p>
          )}
          {/* Completion photo */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoSelect}
            />

            {photoUrl ? (
              <div className="relative h-20 w-20 rounded-lg overflow-hidden">
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
                  className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-9 gap-1"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Camera className="h-3.5 w-3.5" />
                {uploading ? "Uploading..." : "Take Photo"}
              </Button>
            )}
          </div>

          {/* Completion note */}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)..."
            rows={2}
            className="w-full rounded-xl border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
          />

          {/* Complete button */}
          <Button
            onClick={handleComplete}
            disabled={completing || !canComplete}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:bg-emerald-600/40"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {completing ? "Completing..." : "Mark Done"}
          </Button>
        </div>
      )}
    </div>
  );
}

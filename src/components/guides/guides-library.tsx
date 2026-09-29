"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Check,
  FileText,
  Link2,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { createClient } from "@/lib/supabase/client";
import { removeGuide, saveGuide } from "@/lib/actions/how-to-guides";
import {
  GUIDE_CATEGORIES,
  GUIDES_BUCKET,
  newGuideFilePath,
  type HowToGuideWithUrl,
} from "@/lib/guides/guides";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

// Pinned to Eastern so the server render and the browser agree on the day.
function updatedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function pdfName(g: HowToGuideWithUrl): string {
  return g.file_name || `${g.title}.pdf`;
}

export function GuidesLibrary({
  guides,
  canEdit,
  initialOpenId,
  defaultAuthor,
}: {
  guides: HowToGuideWithUrl[];
  canEdit: boolean;
  initialOpenId: string | null;
  defaultAuthor: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [editing, setEditing] = useState<HowToGuideWithUrl | "new" | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = openId ? guides.find((g) => g.id === openId && g.url) : undefined;

  const sections = [...GUIDE_CATEGORIES, ...new Set(guides.map((g) => g.category))]
    .filter((c, i, all) => all.indexOf(c) === i)
    .map((category) => ({ category, items: guides.filter((g) => g.category === category) }))
    .filter((s) => s.items.length > 0);

  function closeViewer() {
    setOpenId(null);
    if (initialOpenId) router.replace("/guides", { scroll: false });
  }

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/guides?open=${id}`);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch {
      setError("Couldn't copy the link");
    }
  }

  async function remove(g: HowToGuideWithUrl) {
    if (!window.confirm(`Take "${g.title}" off the How-To Guides page?`)) return;
    setError(null);
    const res = await removeGuide(g.id);
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">Every guide works the same way:</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] font-semibold">
            {["Ask", "Look", "Draft"].map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-600 text-xs text-white">
                  {i + 1}
                </span>
                {s}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Nothing goes out until you read the draft and say &ldquo;send it.&rdquo;
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing("new")} className="self-start sm:self-center">
            <Plus /> Add a guide
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <BookOpen className="h-8 w-8" />
          <p className="text-sm">No guides yet.</p>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.category} className="flex flex-col gap-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.category}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {section.items.map((g) => (
                <div
                  key={g.id}
                  className="group relative flex rounded-xl border border-border/60 bg-card transition-colors hover:border-amber-500/60"
                >
                  <button
                    type="button"
                    onClick={() => (g.url ? setOpenId(g.id) : setError(`Couldn't open "${g.title}"`))}
                    className="flex min-w-0 flex-1 items-start gap-3 p-4 text-left"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                      <FileText className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{g.title}</span>
                      {g.summary && (
                        <span className="mt-1 block text-sm text-muted-foreground line-clamp-2">
                          {g.summary}
                        </span>
                      )}
                      <span className="mt-2 block text-xs text-muted-foreground/80">
                        {g.author ? `${g.author} · ` : ""}Updated {updatedLabel(g.updated_at)}
                      </span>
                    </span>
                  </button>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Options for ${g.title}`}
                          className="mr-2 mt-2 shrink-0 text-muted-foreground"
                        >
                          {copiedId === g.id ? <Check className="text-emerald-500" /> : <MoreVertical />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(g)}>
                          <Pencil /> Edit or replace PDF
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => copyLink(g.id)}>
                          <Link2 /> Copy link
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(g)}>
                          <Trash2 /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {open?.url && <PdfViewer url={open.url} filename={pdfName(open)} onClose={closeViewer} />}

      {editing && (
        <GuideEditor
          guide={editing === "new" ? null : editing}
          defaultAuthor={defaultAuthor}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function GuideEditor({
  guide,
  defaultAuthor,
  onClose,
  onSaved,
}: {
  guide: HowToGuideWithUrl | null;
  defaultAuthor: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(guide?.title ?? "");
  const [summary, setSummary] = useState(guide?.summary ?? "");
  const [category, setCategory] = useState(guide?.category ?? "");
  const [author, setAuthor] = useState(guide?.author ?? defaultAuthor);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pickFile(f: File | undefined) {
    setError(null);
    if (!f) return setFile(null);
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return setError("Guides must be PDFs");
    if (f.size > MAX_PDF_BYTES) return setError("That PDF is over 50 MB");
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim());
  }

  async function save() {
    setError(null);
    if (!title.trim()) return setError("Give the guide a title");
    if (!category) return setError("Pick a section");
    if (!guide && !file) return setError("Choose the PDF");

    let uploaded: { path: string; name: string; size: number } | undefined;
    const storage = createClient().storage.from(GUIDES_BUCKET);
    if (file) {
      setBusy("Uploading...");
      const path = newGuideFilePath();
      const { error: upErr } = await storage.upload(path, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upErr) {
        setBusy(null);
        return setError(upErr.message || "Upload failed");
      }
      uploaded = { path, name: file.name, size: file.size };
    }

    setBusy("Saving...");
    const res = await saveGuide({ id: guide?.id, title, summary, category, author, file: uploaded });
    if (res.error) {
      if (uploaded) await storage.remove([uploaded.path]).catch(() => {});
      setBusy(null);
      return setError(res.error);
    }
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{guide ? "Edit guide" : "Add a guide"}</DialogTitle>
          <DialogDescription>
            Everyone in the office and every PM will see it under How-To Guides.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="guide-file">{guide ? "Replace the PDF (optional)" : "PDF"}</Label>
            <input
              ref={fileRef}
              id="guide-file"
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              className="justify-start font-normal"
              onClick={() => fileRef.current?.click()}
            >
              <FileText />
              <span className="truncate">
                {file ? file.name : guide ? guide.file_name || "Current PDF" : "Choose a PDF"}
              </span>
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="guide-title">Title</Label>
            <Input
              id="guide-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Email a drawing to a sub or vendor"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="guide-summary">Use this when...</Label>
            <Textarea
              id="guide-summary"
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Something is missing or wrong on a job and the sub needs to see it on the drawing."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Section</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick one" />
                </SelectTrigger>
                <SelectContent>
                  {GUIDE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guide-author">Made by</Label>
              <Input id="guide-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!!busy}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" /> {busy}
              </>
            ) : guide ? (
              "Save"
            ) : (
              "Add guide"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

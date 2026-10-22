"use client";
/* eslint-disable @next/next/no-img-element -- Upload previews use local blob URLs and private signed assets. */

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, FilePlus2, ImagePlus, Instagram, Loader2, Paperclip, Pause, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createMarketingItem, updateMarketingItem, removeMarketingAsset, reorderMarketingAssets } from "@/lib/actions/marketing";
import type { MarketingAsset, MarketingItem, MarketingProject } from "@/types/marketing";
import { fileSize, kindLabels, messageOf, mimeOf, selectClass } from "./marketing-utils";
import { uploadMarketingFile, type QueuedFile } from "./upload-marketing-file";

type Props = { open: boolean; item: MarketingItem | null; linkOnly?: boolean; projects: MarketingProject[]; onClose: () => void; onSaved: (id: string) => Promise<void> };
type Entry = { id: string; existing?: MarketingAsset; queued?: QueuedFile };

export function MarketingEditor({ open, item, linkOnly = false, projects, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(item?.title || "");
  const [kind, setKind] = useState<MarketingItem["kind"]>(item?.kind || "video");
  const [status, setStatus] = useState<MarketingItem["status"]>(item?.status || (linkOnly ? "posted" : "draft"));
  const [description, setDescription] = useState(item?.description || "");
  const [caption, setCaption] = useState(item?.caption || "");
  const [project, setProject] = useState(item?.project_id || "");
  const [instagram, setInstagram] = useState(item?.instagram_url || "");
  const [postedAt, setPostedAt] = useState(item?.posted_at?.slice(0, 10) || "");
  const [entries, setEntries] = useState<Entry[]>(() => (item?.assets || []).map(existing => ({ id: existing.id, existing })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savingLabel, setSavingLabel] = useState("");
  const itemId = useRef(item?.id || "");
  const abort = useRef<AbortController | null>(null);
  const entriesRef = useRef(entries);
  const urls = useRef<string[]>([]);
  const mediaInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const downloadInput = useRef<HTMLInputElement>(null);
  entriesRef.current = entries;

  useEffect(() => () => {
    abort.current?.abort();
    urls.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const keepUploadOpen = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", keepUploadOpen);
    return () => window.removeEventListener("beforeunload", keepUploadOpen);
  }, [busy]);

  const patchEntry = (id: string, patch: Partial<QueuedFile>) => {
    // The upload loop needs each reservation and finalized asset immediately,
    // even while React is batching progress renders.
    const next = entriesRef.current.map(entry => entry.id === id && entry.queued ? { ...entry, queued: { ...entry.queued, ...patch } } : entry);
    entriesRef.current = next;
    setEntries(next);
  };

  const addFiles = (files: FileList | null, role: QueuedFile["role"]) => {
    if (!files) return;
    setError("");
    const added: Entry[] = [];
    for (const file of Array.from(files)) {
      const mime = mimeOf(file);
      if (!file.size) { setError(`“${file.name}” is empty. Choose a different file.`); continue; }
      if (file.size > 500 * 1024 * 1024) { setError(`“${file.name}” is larger than 500 MB. Choose a smaller export.`); continue; }
      if (role === "media" && !mime.startsWith("image/") && !mime.startsWith("video/")) { setError("Choose images or videos for the preview. Use Attach files for PDFs and ZIPs."); continue; }
      if (role === "cover" && !mime.startsWith("image/")) { setError("Choose an image for the cover."); continue; }
      const id = crypto.randomUUID();
      const preview = mime.startsWith("image/") || mime.startsWith("video/") ? URL.createObjectURL(file) : undefined;
      if (preview) urls.current.push(preview);
      added.push({ id, queued: { id, file, role, preview, progress: 0, state: "queued" } });
    }
    setEntries(current => {
      // One deliberate cover per item; replacing a cover is applied on Save.
      if (role !== "cover" || !added.length) return [...current, ...added];
      const covers = current.filter(entry => (entry.existing?.role || entry.queued?.role) === "cover");
      setRemoved(previous => [...new Set([...previous, ...covers.flatMap(entry => entry.existing ? [entry.existing.id] : entry.queued?.asset ? [entry.queued.asset.id] : [])])]);
      return [...current.filter(entry => !covers.includes(entry)), added[0]];
    });
    if (!item && !title && added[0]) setTitle(added[0].queued!.file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    if (!item && role === "media" && added.length > 1 && added.every(entry => mimeOf(entry.queued!.file).startsWith("image/"))) setKind("carousel");
  };

  const moveEntry = (index: number, offset: number) => setEntries(current => {
    const next = [...current];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    return next;
  });

  const removeEntry = (entry: Entry) => {
    const assetId = entry.existing?.id || entry.queued?.asset?.id;
    if (assetId) setRemoved(current => [...current, assetId]);
    setEntries(current => current.filter(candidate => candidate.id !== entry.id));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!title.trim()) { setError("Give this item a title."); return; }
    if (linkOnly && !instagram.trim()) { setError("Add the Instagram post or Reel link."); return; }
    if (instagram && !/^https:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/[^\s/?#]+\/?(?:[?#].*)?$/i.test(instagram.trim())) { setError("Use a full Instagram post or Reel link, such as https://www.instagram.com/reel/…"); return; }
    if (status === "posted" && !instagram.trim()) { setError("Add the Instagram link before marking this item Posted."); return; }
    if (!itemId.current && !instagram.trim() && !entries.length) { setError("Add a video, images, attachment, or Instagram link."); return; }
    setBusy(true);
    abort.current = new AbortController();
    try {
      setSavingLabel("Saving details…");
      const input = { title: title.trim(), description: description.trim(), caption: caption.trim(), kind, status, project_id: project || null, instagram_url: instagram.trim() || null, posted_at: postedAt || null };
      if (!itemId.current) {
        // New uploads start as a draft until every selected file is verified.
        const created = await createMarketingItem({ ...input, status: "draft" });
        if (!created.id) throw new Error(created.error || "Could not create this item.");
        itemId.current = created.id;
      }
      const queued = entriesRef.current.filter(entry => entry.queued && entry.queued.state !== "done");
      for (let index = 0; index < queued.length; index++) {
        const entry = entriesRef.current.find(candidate => candidate.id === queued[index].id)!;
        const file = entry.queued!;
        setSavingLabel(`Uploading ${index + 1} of ${queued.length}…`);
        patchEntry(entry.id, { state: "uploading", error: undefined });
        try {
          const asset = await uploadMarketingFile(itemId.current, file, entriesRef.current.findIndex(candidate => candidate.id === entry.id), abort.current.signal,
            progress => patchEntry(entry.id, { progress }),
            reservation => patchEntry(entry.id, { reservation }));
          patchEntry(entry.id, { state: "done", progress: 100, asset });
        } catch (uploadError) {
          patchEntry(entry.id, { state: "error", error: messageOf(uploadError) });
          throw uploadError;
        }
      }
      setSavingLabel("Finishing…");
      for (const assetId of removed) {
        const result = await removeMarketingAsset(assetId);
        if (result.error) throw new Error(result.error);
        setRemoved(current => current.filter(id => id !== assetId));
      }
      setRemoved([]);
      const assetIds = entriesRef.current.map(entry => entry.existing?.id || entry.queued?.asset?.id).filter((id): id is string => !!id);
      if (assetIds.length) {
        const sorted = await reorderMarketingAssets(itemId.current, assetIds);
        if (sorted.error) throw new Error(sorted.error);
      }
      const saved = await updateMarketingItem(itemId.current, input);
      if (saved.error) throw new Error(saved.error);
      await onSaved(itemId.current);
      onClose();
    } catch (saveError) {
      setError(messageOf(saveError));
    } finally {
      setBusy(false);
      setSavingLabel("");
      abort.current = null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader className="pr-5 text-left">
          <DialogTitle>{item ? "Edit marketing item" : linkOnly ? "Save an Instagram post" : "Add to your marketing library"}</DialogTitle>
          <DialogDescription>{linkOnly ? "Keep the post link, caption, and original files together. Add a cover to make it easy to find." : "Keep videos, carousel slides, captions, and download files in one place."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={busy} className="space-y-5 disabled:opacity-80">
            <div className="space-y-2"><Label htmlFor="marketing-title">Title</Label><Input id="marketing-title" value={title} maxLength={160} onChange={event => setTitle(event.target.value)} placeholder="e.g. Peabody kitchen reveal" required autoFocus /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="marketing-kind">Type</Label><select id="marketing-kind" className={`${selectClass} w-full`} value={kind} onChange={event => setKind(event.target.value as MarketingItem["kind"])}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <div className="space-y-2"><Label htmlFor="marketing-status">Status</Label><select id="marketing-status" className={`${selectClass} w-full`} value={status} onChange={event => setStatus(event.target.value as MarketingItem["status"])}><option value="draft">Draft</option><option value="ready">Ready</option><option value="posted">Posted</option></select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="marketing-project">Project <span className="font-normal text-muted-foreground">(optional)</span></Label><select id="marketing-project" className={`${selectClass} w-full`} value={project} onChange={event => setProject(event.target.value)}><option value="">General marketing</option>{projects.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2"><Label>Media & files</Label><span className="text-xs text-muted-foreground">Carousel order follows this list</span></div>
              <input ref={mediaInput} className="sr-only" aria-label="Choose images or videos" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={event => { addFiles(event.target.files, "media"); event.target.value = ""; }} />
              <input ref={coverInput} className="sr-only" aria-label="Choose cover image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => { addFiles(event.target.files, "cover"); event.target.value = ""; }} />
              <input ref={downloadInput} className="sr-only" aria-label="Choose download files" type="file" multiple accept=".pdf,.zip,.txt,.jpg,.jpeg,.png,.mp4,.mov,.webm" onChange={event => { addFiles(event.target.files, "download"); event.target.value = ""; }} />
              {!entries.length && <button type="button" className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-5 py-8 text-center transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-primary" onClick={() => mediaInput.current?.click()}><UploadCloud className="size-7 text-primary" /><span className="text-sm font-medium">Choose videos or carousel images</span><span className="text-xs text-muted-foreground">MP4, MOV, WebM, JPG, PNG, WebP, or GIF</span></button>}
              <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => mediaInput.current?.click()}><FilePlus2 />Add media</Button><Button type="button" variant="outline" size="sm" onClick={() => coverInput.current?.click()}><ImagePlus />Cover image</Button><Button type="button" variant="outline" size="sm" onClick={() => downloadInput.current?.click()}><Paperclip />Attach files</Button></div>
              <div className="space-y-2">{entries.map((entry, index) => {
                const file = entry.existing || entry.queued?.asset;
                const filename = file?.filename || entry.queued!.file.name;
                const mime = file?.mime_type || mimeOf(entry.queued!.file);
                const preview = file?.url || entry.queued?.preview;
                const role = file?.role || entry.queued!.role;
                return <div key={entry.id} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
                  <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">{mime.startsWith("image/") && preview ? <img src={preview} alt="" className="size-full object-cover" /> : <Paperclip className="size-4 text-muted-foreground" />}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={filename}>{filename}</p><p className="text-xs text-muted-foreground">{role === "media" ? `Slide / media ${index + 1}` : role === "cover" ? "Cover image" : "Download"} · {fileSize(file?.size || entry.queued!.file.size)}{entry.queued?.state === "done" && " · Saved"}</p>{entry.queued?.state === "uploading" && <><progress aria-label={`Uploading ${filename}`} value={entry.queued.progress} max={100} className="mt-1 h-1.5 w-full accent-orange-500" /><p className="text-xs text-muted-foreground">{entry.queued.progress}%</p></>}{entry.queued?.error && <p className="mt-1 text-xs text-destructive">{entry.queued.error}</p>}</div>
                  <div className="flex shrink-0 flex-col"><button type="button" className="rounded p-1 hover:bg-muted disabled:opacity-25" disabled={index === 0 || busy} aria-label={`Move ${filename} up`} onClick={() => moveEntry(index, -1)}><ArrowUp className="size-3.5" /></button><button type="button" className="rounded p-1 hover:bg-muted disabled:opacity-25" disabled={index === entries.length - 1 || busy} aria-label={`Move ${filename} down`} onClick={() => moveEntry(index, 1)}><ArrowDown className="size-3.5" /></button></div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${filename}`} onClick={() => removeEntry(entry)}><X /></Button>
                </div>;
              })}</div>
            </div>
            <div className="space-y-2"><Label htmlFor="marketing-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="marketing-description" value={description} maxLength={10000} onChange={event => setDescription(event.target.value)} placeholder="What is this piece about?" rows={2} /></div>
            <div className="space-y-2"><Label htmlFor="marketing-caption">Caption & hashtags</Label><Textarea id="marketing-caption" value={caption} maxLength={10000} onChange={event => setCaption(event.target.value)} placeholder="The caption to copy when posting…" rows={5} /></div>
            <div className="space-y-3 rounded-xl border bg-muted/30 p-4"><p className="flex items-center gap-2 text-sm font-medium"><Instagram className="size-4" />Instagram post</p><div className="space-y-2"><Label htmlFor="marketing-instagram">Post or Reel link {status !== "posted" && <span className="font-normal text-muted-foreground">(optional)</span>}</Label><Input id="marketing-instagram" type="url" value={instagram} onChange={event => setInstagram(event.target.value)} placeholder="https://www.instagram.com/reel/…" required={status === "posted" || linkOnly} /></div><div className="space-y-2"><Label htmlFor="marketing-posted-at">Date posted <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="marketing-posted-at" type="date" value={postedAt} onChange={event => setPostedAt(event.target.value)} /></div><p className="text-xs text-muted-foreground">Saving here organizes your library. It does not publish to Instagram.</p></div>
          </fieldset>
          {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <div className="sticky -bottom-6 flex items-center justify-end gap-2 border-t bg-background py-4">
            {busy ? <Button type="button" variant="outline" onClick={() => abort.current?.abort()}><Pause />Pause upload</Button> : <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>}
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{busy ? savingLabel : error && itemId.current ? "Retry & save" : "Save item"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

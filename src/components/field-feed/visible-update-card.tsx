"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SignedPhoto } from "@/lib/actions/daily-logs";
import { requestFeedPhotos } from "./feed-photo-requests";
import type { CommandCenterUpdate } from "@/lib/feed/command-center-updates";
import { DailyLogPost } from "./daily-log-post";
import { CompanyPostCard } from "./company-post-card";
import { PunchListGroupPost } from "./punch-list-group-post";

/** Keep the native card mounted (including its edits/deletion state), but mint
 * private media URLs only when this card approaches the viewport. */
export function VisibleUpdateCard({ item, focus = false, onDeleted }: { item: CommandCenterUpdate; focus?: boolean; onDeleted?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(focus);
  const [signed, setSigned] = useState<Record<string, SignedPhoto>>({});
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const paths = item.type === "logPost" ? item.log.photo_signed_urls.length ? [] : item.log.photo_storage_paths ?? [] :
    item.type === "companyPost" ? item.post.photoUrls.length ? [] : item.post.photoStoragePaths ?? [] :
      item.group.items.flatMap((entry) => [...(entry.photo_signed_urls.length ? [] : entry.photo_storage_paths ?? []), ...(!entry.completion_photo_url && entry.completion_photo_path ? [entry.completion_photo_path] : [])]);
  const pathsKey = [...new Set(paths)].join("\0");
  const bucket = item.type === "logPost" ? "logs" : "project";

  useEffect(() => {
    if (!focus || item.type !== "punchGroupPost") return;
    const timer = setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    return () => clearTimeout(timer);
  }, [focus, item.type]);

  useEffect(() => {
    if (visible || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "500px 0px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !pathsKey) return;
    let cancelled = false;
    const allPaths = pathsKey.split("\0").filter((path) => !signed[path]?.full);
    if (!allPaths.length) return;
    setFailed(false);
    void (async () => {
      try {
        const result = await requestFeedPhotos(bucket, allPaths);
        if (cancelled) return;
        setSigned((current) => ({ ...current, ...result }));
        if (allPaths.some((path) => !result[path]?.full)) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // Signed state is intentionally excluded: only visibility, changed paths,
    // or an explicit retry should issue another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pathsKey, bucket, attempt]);

  const hydrated = useMemo((): CommandCenterUpdate => {
    const urls = (raw: string[] | undefined, thumb = false) => (raw ?? [])
      .map((path) => thumb ? signed[path]?.thumb ?? signed[path]?.full : signed[path]?.full)
      .filter((url): url is string => !!url);
    if (item.type === "logPost") return { ...item, log: { ...item.log,
      photo_signed_urls: item.log.photo_signed_urls.length ? item.log.photo_signed_urls : urls(item.log.photo_storage_paths),
      photo_thumb_urls: item.log.photo_signed_urls.length ? item.log.photo_thumb_urls : urls(item.log.photo_storage_paths, true),
    } };
    if (item.type === "companyPost") return { ...item, post: { ...item.post,
      photoUrls: item.post.photoUrls.length ? item.post.photoUrls : urls(item.post.photoStoragePaths),
      photoThumbUrls: item.post.photoUrls.length ? item.post.photoThumbUrls : urls(item.post.photoStoragePaths, true),
    } };
    return { ...item, group: { ...item.group, items: item.group.items.map((entry) => ({ ...entry,
      photo_signed_urls: entry.photo_signed_urls.length ? entry.photo_signed_urls : urls(entry.photo_storage_paths),
      photo_thumb_urls: entry.photo_signed_urls.length ? entry.photo_thumb_urls : urls(entry.photo_storage_paths, true),
      completion_photo_url: entry.completion_photo_url ?? (entry.completion_photo_path ? signed[entry.completion_photo_path]?.full ?? null : null),
    })) } };
  }, [item, signed]);

  return <div ref={ref}>
    {hydrated.type === "logPost" ? <DailyLogPost log={hydrated.log} focus={focus} linkProject onDeleted={onDeleted} /> :
      hydrated.type === "companyPost" ? <CompanyPostCard post={hydrated.post} focus={focus} onDeleted={onDeleted} /> :
        <PunchListGroupPost group={hydrated.group} onDeleted={onDeleted} />}
    {failed && <button type="button" className="mt-2 rounded-lg px-3 py-2 text-xs text-amber-400" onClick={() => setAttempt((value) => value + 1)}>Retry photos</button>}
  </div>;
}

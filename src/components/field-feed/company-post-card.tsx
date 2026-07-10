"use client";

import { useState } from "react";
import { Building2, HardHat, Users } from "lucide-react";
import type {
  CompanyFeedPost,
  CompanyFeedTag,
} from "@/lib/actions/company-feed";
import { ImageViewer } from "@/components/ui/image-viewer";
import { v } from "./tokens";

function initials(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/);
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function colorFromId(id: string): string {
  const palette = ["#B45309", "#0E7490", "#7C3AED", "#BE123C", "#047857", "#0369A1"];
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function relativeTime(value: string): string {
  const date = new Date(value);
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function TagIcon({ type }: { type: CompanyFeedTag["type"] }) {
  if (type === "job") return <HardHat className="h-3 w-3" />;
  if (type === "worker") return <Users className="h-3 w-3" />;
  return <Building2 className="h-3 w-3" />;
}

export function CompanyPostCard({ post }: { post: CompanyFeedPost }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const author = post.authorName?.trim() || post.authorEmail?.split("@")[0] || "Teammate";
  const visibleTags = post.tags.filter((tag) => tag.type !== "job");

  return (
    <>
      <article
        className="overflow-hidden rounded-2xl"
        style={{ background: v("card"), border: `1px solid ${v("line")}` }}
      >
        <header className="flex items-center gap-3 px-3.5 py-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ background: colorFromId(post.authorId) }}
          >
            {initials(post.authorName, post.authorEmail)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold" style={{ color: v("ink") }}>
              {author}
            </div>
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: v("quiet") }}>
              <span>Company post</span>
              <span aria-hidden="true">·</span>
              <span>{relativeTime(post.createdAt)}</span>
            </div>
          </div>
          {post.projectName && (
            <span
              className="inline-flex max-w-[42%] items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold"
              style={{ background: "rgba(217,119,6,0.12)", color: "#F59E0B" }}
            >
              <HardHat className="h-3 w-3 shrink-0" />
              <span className="truncate">{post.projectName}</span>
            </span>
          )}
        </header>

        {post.body && (
          <p className="whitespace-pre-wrap break-words px-3.5 pb-3 text-[14px] leading-relaxed" style={{ color: v("ink") }}>
            {post.body}
          </p>
        )}

        {post.photoUrls.length > 0 && (
          <div className={`grid gap-0.5 bg-black ${
            post.photoUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"
          }`}>
            {post.photoUrls.slice(0, 4).map((url, index) => (
              <button
                key={url}
                type="button"
                onClick={() => setPreviewUrl(url)}
                className={`relative block overflow-hidden ${
                  post.photoUrls.length === 1 ? "aspect-[4/3]" : "aspect-square"
                }`}
                aria-label={`Open photo ${index + 1} of ${post.photoUrls.length}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover transition-transform active:scale-[0.99]"
                />
                {index === 3 && post.photoUrls.length > 4 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xl font-bold text-white">
                    +{post.photoUrls.length - 4}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {visibleTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
            {visibleTags.map((tag) => (
              <span
                key={`${tag.type}-${tag.id}`}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium"
                style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("muted") }}
              >
                <TagIcon type={tag.type} />
                @{tag.token}
              </span>
            ))}
          </div>
        )}
      </article>

      <ImageViewer
        url={previewUrl}
        urls={post.photoUrls}
        filename="Company post photo"
        onClose={() => setPreviewUrl(null)}
      />
    </>
  );
}

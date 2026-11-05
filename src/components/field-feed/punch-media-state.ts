import type { FeedPunchGroup } from "@/lib/actions/daily-logs";

type Item = FeedPunchGroup["items"][number];

/** Private URLs can arrive after optimistic edits. Only merge media for the
 * same underlying paths; a stale unsigned payload must not erase local media. */
export function mergePunchMedia(item: Item, source: Item, previousSource?: Item): Item {
  const samePhotos = (item.photo_storage_paths ?? []).join("\0") === (source.photo_storage_paths ?? []).join("\0");
  const sameCompletion = item.completion_photo_path === source.completion_photo_path;
  const photosFollowServer = previousSource && (item.photo_storage_paths ?? []).join("\0") === (previousSource.photo_storage_paths ?? []).join("\0");
  const completionFollowsServer = previousSource && item.completion_photo_path === previousSource.completion_photo_path;
  return {
    ...item,
    ...(photosFollowServer && !samePhotos ? {
      photo_storage_paths: source.photo_storage_paths,
      photo_signed_urls: source.photo_signed_urls,
      photo_thumb_urls: source.photo_thumb_urls,
    } : samePhotos && source.photo_signed_urls.length ? {
      photo_signed_urls: source.photo_signed_urls,
      photo_thumb_urls: source.photo_thumb_urls,
    } : {}),
    ...(completionFollowsServer && !sameCompletion ? {
      completion_photo_path: source.completion_photo_path,
      completion_photo_url: source.completion_photo_url,
    } : sameCompletion && source.completion_photo_url ? {
      completion_photo_url: source.completion_photo_url,
    } : {}),
  };
}

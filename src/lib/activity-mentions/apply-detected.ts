import type { ActivityMention } from "@/lib/actions/activity-mentions";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert confidently detected spoken names into the same @tokens used by the
 * manual picker. If speech-to-text mangled the name, keep the note untouched
 * and append a visible tag for the user to review before posting.
 */
export function applyDetectedMentions(
  text: string,
  detected: ActivityMention[],
): string {
  let next = text.trim();
  for (const mention of detected) {
    const token = `@${mention.token}`;
    if (next.toLowerCase().includes(token.toLowerCase())) continue;

    const names = [
      mention.label,
      mention.label.trim().split(/\s+/)[0] ?? "",
    ].filter(Boolean);
    let replaced = false;
    for (const name of names) {
      const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
      if (!pattern.test(next)) continue;
      next = next.replace(pattern, token);
      replaced = true;
      break;
    }
    if (!replaced) next = `${next}${next ? "\n\n" : ""}${token}`;
  }
  return next;
}

import type { ActivityMention } from "@/lib/actions/activity-mentions";

/**
 * "Group" mentions fan a single tag out to a set of teammates:
 *   @Everyone → the whole company
 *   @Office   → office-role profiles (anyone whose role is not "field")
 *   @Field    → the field crew (role === "field")
 *
 * These are sentinel mentions — their ids are fixed placeholder UUIDs so they
 * satisfy the tag schema, but they never map to a real profile/job/sub row.
 * The recipient fan-out happens server-side in postDailyLog /
 * createCompanyFeedPost. Kept in a plain (non-"use server") module so the
 * constants can be imported by client composers as well as server actions.
 */
export type GroupMentionType = "everyone" | "office" | "field";

export const EVERYONE_MENTION_ID = "00000000-0000-4000-8000-000000000000";
export const OFFICE_MENTION_ID = "00000000-0000-4000-8000-000000000001";
export const FIELD_MENTION_ID = "00000000-0000-4000-8000-000000000002";

/** Ordered as they appear at the top of the @ picker. */
export const GROUP_MENTIONS: ActivityMention[] = [
  {
    id: EVERYONE_MENTION_ID,
    type: "everyone",
    label: "Everyone",
    detail: "Notify the whole team",
    token: "Everyone",
    profileId: null,
  },
  {
    id: OFFICE_MENTION_ID,
    type: "office",
    label: "Office",
    detail: "Notify the office team",
    token: "Office",
    profileId: null,
  },
  {
    id: FIELD_MENTION_ID,
    type: "field",
    label: "Field",
    detail: "Notify the field crew",
    token: "Field",
    profileId: null,
  },
];

export function isGroupMentionType(
  type: ActivityMention["type"],
): type is GroupMentionType {
  return type === "everyone" || type === "office" || type === "field";
}

/**
 * True when a profile (by role) belongs to the given group. Field crew are
 * `role === "field"`; office is everyone else with a real role. `@Everyone`
 * always matches. Mirrors how rate-visibility treats `role !== "field"` as
 * office.
 */
export function profileInGroup(
  group: GroupMentionType,
  role: string | null | undefined,
): boolean {
  if (group === "everyone") return true;
  if (group === "field") return role === "field";
  // office
  return !!role && role !== "field";
}

/** Short human label for a group tag, e.g. for warning banners. */
export function groupAudienceLabel(type: GroupMentionType): string {
  if (type === "everyone") return "the entire team";
  if (type === "office") return "the whole office team";
  return "the whole field crew";
}

export type EosRockStatus = "on_track" | "off_track" | "complete" | "incomplete";
export type EosRockType = "company" | "individual";
export type EosIssueStatus = "open" | "solved" | "dropped";
export type EosIssueTerm = "short_term" | "long_term";
export type EosTodoStatus = "open" | "done" | "dropped";
export type EosMeetingStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type EosUnit = "number" | "currency" | "percentage" | "yes_no" | "duration";
export type EosCadence = "weekly" | "monthly" | "quarterly";
export type EosHeadlineKind = "customer" | "employee";

export interface EosPerson {
  id: string;
  name: string;
  email: string;
  seatLabel: string | null;
}

export interface EosTeam {
  id: string;
  name: string;
  isLeadership: boolean;
  meetingDay: number | null;
  meetingTime: string | null;
}

export interface EosRock {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  type: EosRockType;
  quarter: string;
  dueDate: string | null;
  status: EosRockStatus;
  sortOrder: number;
  milestones: EosMilestone[];
}

export interface EosMilestone {
  id: string;
  rockId: string;
  title: string;
  dueDate: string | null;
  isDone: boolean;
  sortOrder: number;
}

export interface EosMeasurable {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  unit: EosUnit;
  /** Null when the goal is still "TBD, set at L10". */
  goalTarget: number | null;
  comparison: string;
  cadence: EosCadence;
  sortOrder: number;
  /** week_ending (YYYY-MM-DD) → value */
  scores: Record<string, number | null>;
}

export interface EosIssue {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  term: EosIssueTerm;
  status: EosIssueStatus;
  priority: number | null;
  solution: string | null;
  solvedAt: string | null;
  source: string;
  createdAt: string;
}

export interface EosTodo {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: EosTodoStatus;
  completedAt: string | null;
  meetingId: string | null;
  createdAt: string;
}

export interface EosHeadline {
  id: string;
  kind: EosHeadlineKind;
  body: string;
  meetingId: string | null;
  createdAt: string;
}

export interface EosAttendee {
  profileId: string;
  name: string;
  seatLabel: string | null;
  isPresent: boolean;
  personalBest: string | null;
  businessBest: string | null;
  rating: number | null;
}

export interface EosSectionLogEntry {
  key: string;
  started_at: string;
  ended_at: string | null;
}

export interface EosMeeting {
  id: string;
  teamId: string;
  meetingDate: string;
  status: EosMeetingStatus;
  startedAt: string | null;
  endedAt: string | null;
  currentSection: string | null;
  sectionStartedAt: string | null;
  sectionLog: EosSectionLogEntry[];
  cascadingMessage: string | null;
  notes: string | null;
  avgRating: number | null;
}

export interface EosSeat {
  id: string;
  parentId: string | null;
  name: string;
  holderProfileId: string | null;
  holderName: string | null;
  roles: string[];
  sortOrder: number;
}

export interface EosCoreValue {
  title: string;
  description: string;
}

export interface EosVto {
  teamId: string;
  coreValues: EosCoreValue[];
  purpose: string | null;
  niche: string | null;
  tenYearTarget: string | null;
  targetMarket: string | null;
  threeUniques: string[];
  provenProcess: string | null;
  guarantee: string | null;
  threeYearDate: string | null;
  threeYearRevenue: number | null;
  threeYearProfit: number | null;
  threeYearMeasurables: string | null;
  threeYearPicture: string[];
  oneYearDate: string | null;
  oneYearRevenue: number | null;
  oneYearProfit: number | null;
  oneYearMeasurables: string | null;
  oneYearGoals: string[];
}

export type EosActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

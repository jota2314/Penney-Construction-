/**
 * Shapes for turning a spoken Level 10 into filled-in EOS records.
 *
 * The allocator returns PROPOSALS, never writes. Every proposal arrives
 * pre-checked in the UI so the meeting leader taps Apply once instead of
 * typing — but nothing lands in the DB until they do.
 */

export interface SegueProposal {
  /** Profile id resolved from the roster, or null if the name didn't match. */
  profileId: string | null;
  spokenName: string;
  personalBest: string | null;
  businessBest: string | null;
}

export interface ScoreProposal {
  measurableId: string;
  measurableName: string;
  value: number;
}

export interface RockStatusProposal {
  rockId: string;
  rockTitle: string;
  status: "on_track" | "off_track" | "complete";
}

export interface HeadlineProposal {
  kind: "customer" | "employee";
  body: string;
}

export interface TodoStatusProposal {
  todoId: string;
  title: string;
  status: "done" | "open";
}

export interface NewTodoProposal {
  title: string;
  ownerProfileId: string | null;
  ownerName: string | null;
  dueDate: string | null;
}

export interface NewIssueProposal {
  title: string;
  description: string | null;
  ownerProfileId: string | null;
  ownerName: string | null;
  term: "short_term" | "long_term";
}

export interface SolvedIssueProposal {
  issueId: string;
  title: string;
  solution: string;
}

export interface RatingProposal {
  profileId: string | null;
  spokenName: string;
  rating: number;
}

/** Everything the allocator can propose. Sections fill only what applies. */
export interface MeetingAllocation {
  segues: SegueProposal[];
  scores: ScoreProposal[];
  rockStatuses: RockStatusProposal[];
  headlines: HeadlineProposal[];
  todoStatuses: TodoStatusProposal[];
  newTodos: NewTodoProposal[];
  newIssues: NewIssueProposal[];
  solvedIssues: SolvedIssueProposal[];
  ratings: RatingProposal[];
  cascadingMessage: string | null;
  /** One line on what the AI heard, shown above the proposals. */
  summary: string | null;
}

export const EMPTY_ALLOCATION: MeetingAllocation = {
  segues: [],
  scores: [],
  rockStatuses: [],
  headlines: [],
  todoStatuses: [],
  newTodos: [],
  newIssues: [],
  solvedIssues: [],
  ratings: [],
  cascadingMessage: null,
  summary: null,
};

export function isAllocationEmpty(a: MeetingAllocation): boolean {
  return (
    a.segues.length === 0 &&
    a.scores.length === 0 &&
    a.rockStatuses.length === 0 &&
    a.headlines.length === 0 &&
    a.todoStatuses.length === 0 &&
    a.newTodos.length === 0 &&
    a.newIssues.length === 0 &&
    a.solvedIssues.length === 0 &&
    a.ratings.length === 0 &&
    !a.cascadingMessage
  );
}

export function allocationCount(a: MeetingAllocation): number {
  return (
    a.segues.length +
    a.scores.length +
    a.rockStatuses.length +
    a.headlines.length +
    a.todoStatuses.length +
    a.newTodos.length +
    a.newIssues.length +
    a.solvedIssues.length +
    a.ratings.length +
    (a.cascadingMessage ? 1 : 0)
  );
}

/** What the allocator is allowed to propose for each agenda section. */
export const SECTION_OUTPUTS: Record<string, string[]> = {
  segue: ["segues"],
  scorecard: ["scores", "newIssues"],
  rocks: ["rockStatuses", "newIssues"],
  headlines: ["headlines", "newIssues", "newTodos"],
  todos: ["todoStatuses", "newTodos", "newIssues"],
  ids: ["newIssues", "solvedIssues", "newTodos"],
  conclude: ["cascadingMessage", "ratings", "newTodos"],
};

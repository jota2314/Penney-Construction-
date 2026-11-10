/**
 * The PM change-order training test (/guides/pm-test).
 *
 * This file is the PUBLIC half: the situations a new PM reads, and the shapes
 * the page passes around. It is imported by the client component, so nothing
 * here may hint at an answer. The answer key and the scoring live in
 * `pm-test-scoring.ts`, which only the server action imports.
 */

export const PM_TEST_KEY = "pm-change-orders-v1";

export const PM_TEST_MAX_SCORE = 100;
export const PM_TEST_WRITTEN_MAX = 70;
export const PM_TEST_HANDS_ON_MAX = 30;

/** Longest answer the server accepts for one situation. */
export const PM_TEST_ANSWER_MAX_CHARS = 4000;

export interface PmTestSituation {
  n: number;
  title: string;
  prompt: string;
}

export const PM_TEST_SITUATIONS: readonly PmTestSituation[] = [
  {
    n: 1,
    title: "The fan",
    prompt:
      'The client emails: "The old fan just blew into the attic. Can you add a fan that vents outside? Send me the extra."',
  },
  {
    n: 2,
    title: "The niche",
    prompt:
      'The tile setter is on site. The client tells him they want a 12x24 niche in the tub wall and says to you: "Go ahead, I\'ll sign whatever later." The tile setter quotes you $380 and can do it today. Later the client asks you to forward his quote so they can see what he charges.',
  },
  {
    n: 3,
    title: "The subfloor",
    prompt:
      'Demo is done. Your lead carpenter finds about 20 sq ft of rotted subfloor around the toilet. The fix costs us $520 in labor and material. The plumber roughs in tomorrow. The client says: "You should have known. That should be included."',
  },
  {
    n: 4,
    title: "The outlet",
    prompt:
      "You find out the electrician added an outlet next to the mirror yesterday because the client asked him on site. It is done. His price is $180. Nothing is written down.",
  },
  {
    n: 5,
    title: "The tile",
    prompt:
      'The client emails: "I found tile I love and I\'m buying it myself. Take the tile off my contract. That\'s $8,700, right?"',
  },
  {
    n: 6,
    title: "The permits",
    prompt: "The permit receipts are in: building $210, plumbing $90, electrical $85.",
  },
  {
    n: 7,
    title: "The fixtures",
    prompt: 'The client texts: "Which toilet and faucet are you putting in? I never picked them."',
  },
  {
    n: 8,
    title: "The second payment",
    prompt:
      'Rough plumbing passed inspection today. The rough electrical inspection is Thursday. The client says: "I can drop off a check for the second payment today. Send me the invoice."',
  },
];

/** Answers keyed by situation number as a string ("1".."8"). */
export type PmTestAnswers = Record<string, string>;

/** A change order on the taker's TEST job, as the page lists it. */
export interface PmTestChangeOrder {
  number: number;
  title: string;
  price: number;
  status: string;
  sent: boolean;
  signed: boolean;
}

export interface PmTestCriterionResult {
  id: string;
  label: string;
  points: number;
  met: boolean;
  /** One line from the grader on why, addressed to the taker. */
  note: string;
}

export interface PmTestSituationResult {
  n: number;
  title: string;
  answer: string;
  earned: number;
  max: number;
  rightCall: string;
  criteria: PmTestCriterionResult[];
}

export interface PmTestHandsOnRow {
  key: string;
  label: string;
  expectedPrice: number;
  expectedCost: number;
  found: boolean;
  coNumber: number | null;
  title: string | null;
  price: number | null;
  cost: number | null;
  priceRight: boolean;
  costRight: boolean;
  sent: boolean;
  signed: boolean;
  earned: number;
  max: number;
}

export interface PmTestTrap {
  coNumber: number;
  title: string;
  price: number;
  /** Why this change order should not exist. */
  reason: string;
  penalty: number;
}

export interface PmTestHandsOnResult {
  earned: number;
  max: number;
  hasJob: boolean;
  rows: PmTestHandsOnRow[];
  traps: PmTestTrap[];
  /** Change orders that matched nothing expected and tripped no trap. */
  others: { coNumber: number; title: string; price: number }[];
}

export interface PmTestBreakdown {
  handsOn: PmTestHandsOnResult;
  /** Null until the written answers are graded. */
  written: { earned: number; max: number; situations: PmTestSituationResult[] } | null;
}

export interface PmTestAttempt {
  id: string;
  profileId: string;
  takerName: string;
  status: "graded" | "needs_grading";
  score: number | null;
  maxScore: number;
  answers: PmTestAnswers;
  breakdown: PmTestBreakdown | null;
  submittedAt: string;
}

export interface PmTestState {
  viewerName: string;
  isReviewer: boolean;
  isImpersonating: boolean;
  /** The viewer's TEST job, when one is assigned to them. */
  job: { id: string; projectNumber: string | null; name: string } | null;
  changeOrders: PmTestChangeOrder[];
  attempt: PmTestAttempt | null;
  /** Everyone's attempts. Reviewers only; empty for everyone else. */
  allAttempts: PmTestAttempt[];
}

export function scoreLabel(score: number): string {
  if (score >= 90) return "Ready to run change orders alone";
  if (score >= 75) return "Solid. Go over the misses.";
  if (score >= 60) return "Has the idea, not the habits yet";
  return "Walk through it together, then retake";
}

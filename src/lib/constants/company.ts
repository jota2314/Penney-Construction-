/**
 * Company-wide configuration constants.
 * Move to env vars if this app is ever multi-tenant.
 */

export const COMPANY_EMAILS = [
  "jbetancur@penneyconstructioninc.com",
  "rpenney@penneyconstructioninc.com",
  "nsmith@penneyconstructioninc.com",
  "info@penneyconstructioninc.com",
];

export const COMPANY_DOMAIN = "penneyconstructioninc.com";

export const UNIT_LABELS: Record<string, string> = {
  sqft: "/sqft",
  linear_ft: "/LF",
  each: "/each",
  lump_sum: "lump sum",
};

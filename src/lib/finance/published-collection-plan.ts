import "server-only";

/** Dated management plan transcribed from Jorge's sent team email, not a live receivables forecast.
 * Replace with a newer sourced plan explicitly; never roll these targets into another week/month.
 * All amounts are cents. Reported collections are the email's snapshot, not verified live receipts.
 */
export const publishedCollectionPlan = {
  month: "November 2026",
  /** Calendar month the goal and weekly targets apply to (YYYY-MM). */
  monthKey: "2026-11",
  asOf: "2026-11-02",
  source: {
    messageId: "1a19c9c91dde6cba",
    sentAt: "2026-11-02T14:14:28Z",
    author: "Jorge Betancur",
    subject: "Penney Construction | November collections | Goal: $500,000+",
    url: "https://mail.google.com/mail/u/?authuser=jbetancur%40penneyconstructioninc.com#all/1a19c9c91dde6cba",
  },
  goal: 50000000,
  reportedCollected: 0,
  monthPlan: 45698935,
  focusWeek: "November 2–6, 2026",
  focusWeekTarget: 15601525,
  invoiced: 15601525,
  readyToBill: 0,
  weeks: [
    { label: "November 2–6", start: "2026-11-02", amount: 15601525, status: "Target" },
    { label: "November 9–13", start: "2026-11-09", amount: 10483361, status: "Target" },
    { label: "November 16–20", start: "2026-11-16", amount: 12375117, status: "Target" },
    { label: "November 23–27", start: "2026-11-23", amount: 5731698, status: "Target" },
    { label: "Needs a date", start: null, amount: 1507234, status: "Needs a date" },
  ],
  managers: [
    { name: "Bill", total: 9491203, items: [
      { project: "Ouellette", amount: 7500000, status: "Invoiced", action: "Drywall, trim and flooring draw, invoiced 10/27. Confirm trim and flooring are done and get a payment date." },
      { project: "Jackling change orders", amount: 1991203, status: "Invoiced", action: "Invoiced 10/20. Get a payment date." },
    ] },
    { name: "Howie", total: 4540830, items: [
      { project: "Carpenter", amount: 2289000, status: "Invoiced", action: "Final with change orders, invoiced 10/27. Get a payment date." },
      { project: "Weidlein", amount: 1412400, status: "Invoiced", action: "Mid project + CO #1, invoiced 10/28. Get a payment date." },
      { project: "Dougherty", amount: 839430, status: "Invoiced", action: "Start of work, invoiced 10/28 and work has started. Collect now." },
    ] },
    { name: "PM to assign", total: 1569492, items: [
      { project: "38 Boardman", amount: 988826, status: "Invoiced", action: "Deposit, invoiced 10/19. Get a payment date and set a start date." },
      { project: "Turner deposit", amount: 580666, status: "Invoiced", action: "Invoiced 10/19. We need the check before the 11/10 start." },
    ] },
  ],
  comingUp: [
    { label: "November 9–13", items: [
      { project: "Frechette finishes", amount: 2371998, manager: "Howie", action: "Counters and backsplash done, then invoice." },
      { project: "Rand rough + permit change order", amount: 2107678, manager: "Howie", action: "Confirm rough inspections passed, then invoice." },
      { project: "Jackling plaster and tile", amount: 2000000, manager: "Bill", action: "Confirm plaster and tile are complete, then invoice." },
      { project: "Kane rough", amount: 1341000, manager: "Howie", action: "Rough inspections 11/5 and 11/6, then invoice." },
      { project: "O’Mealia signed change orders", amount: 1243616, manager: "Bill", action: "Bill this week, net of credits." },
      { project: "Ouellette signed change orders", amount: 765669, manager: "Bill", action: "Reconcile and bill this week." },
      { project: "Pelkey framed draw", amount: 653400, manager: "Howie", action: "Nothing billed yet. Confirm the framing date, then invoice. Contract still needs a signature." },
    ] },
    { label: "November 16–20", items: [
      { project: "Harmon framing and steel", amount: 4483800, manager: "Ryan", action: "Framing and steel beam complete 11/13, then invoice." },
      { project: "O’Neill rough", amount: 2440860, manager: "Bill", action: "Confirm rough inspections passed, then invoice." },
      { project: "Haight rough", amount: 1328580, manager: "Bill", action: "Confirm rough inspections passed, then invoice." },
      { project: "Weidlein substantial", amount: 1107516, manager: "Howie", action: "Finals and walkthrough 11/12 and 11/13, then invoice." },
      { project: "Dresser final", amount: 844429, manager: "Bill", action: "Punch 11/9 and 11/10, final building 11/12, then invoice." },
      { project: "Pelkey substantial and final", amount: 798600, manager: "Howie", action: "Confirm the finish date, then invoice. Contract still needs a signature." },
      { project: "Frechette final", amount: 790666, manager: "Howie", action: "Finals 11/9 and 11/10, then invoice." },
      { project: "Turner start of work", amount: 580666, manager: "PM to assign", action: "Invoice 11/10." },
    ] },
    { label: "November 23–27", items: [
      { project: "Rand tile and plaster", amount: 2011506, manager: "Howie", action: "Upstairs bath tile and plaster repairs done by 11/20, then invoice." },
      { project: "Dougherty rough", amount: 1678860, manager: "Howie", action: "Rough inspections 11/13 and 11/16, then invoice." },
      { project: "Jackling final", amount: 852311, manager: "Bill", action: "Finals 11/19 and 11/20, then invoice." },
      { project: "Turner framing, skylights and rough electrical", amount: 774221, manager: "PM to assign", action: "Rough electrical inspection 11/18, then invoice." },
      { project: "Weidlein final", amount: 414800, manager: "Howie", action: "Finals and walkthrough 11/12 and 11/13, then invoice." },
    ] },
    { label: "Needs a date", items: [
      { project: "Puleo", amount: 751650, manager: "Ryan", status: "Invoiced", action: "Settle the wallpaper credit and punch, then confirm the net payment." },
      { project: "LaPointe", amount: 463300, manager: "Ryan", status: "Invoiced", action: "Resolve the remaining work and any door credit, then confirm payment." },
      { project: "Porter", amount: 175000, manager: "PM to assign", status: "Invoiced", action: "Deposit, due the first day of work. Set a start date." },
      { project: "McNamara chimney repair", amount: 117284, manager: "PM to assign", status: "Invoiced", action: "Invoiced 10/14. Get a payment date." },
    ] },
  ],
  conditional: [
    { project: "Ouellette final", amount: 3802770, manager: "Bill", action: "Countertops, finish electrical, punch and final building by 11/23." },
    { project: "Haight tile", amount: 1328580, manager: "Bill", action: "Tile complete by 11/23." },
  ],
  unsignedChangeOrders: "Pedersen #7 and #8 $12,702.97; Ouellette #24 and #28 $6,911.50; Gallegos Doors #1 $2,560.00; Jackling #5 $998.86; Frechette #2 and #3 $816.00; Haight #1 $575.00.",
  note: "Howie, Bill and Ryan reply with what is ready to invoice and what they expect to collect by Friday, November 6, and report finished milestones the same day. Nicole and Luis match the four receipts still open in the app to their invoices.",
} as const;

export type PublishedCollectionPlan = typeof publishedCollectionPlan;

// Verified Penney project identities for this dated plan. Invoices are fetched
// by these IDs, never matched by a loose client name or a coincidental amount.
export const collectionPlanProjectIds: Record<string, string> = {
  "Ouellette": "683fd513-00d9-4779-93bc-8292483980ec",
  "Ouellette signed change orders": "683fd513-00d9-4779-93bc-8292483980ec",
  "Ouellette final": "683fd513-00d9-4779-93bc-8292483980ec",
  "Jackling change orders": "e3ad2c0a-0d92-4489-a447-c501ac93204e",
  "Jackling plaster and tile": "e3ad2c0a-0d92-4489-a447-c501ac93204e",
  "Jackling final": "e3ad2c0a-0d92-4489-a447-c501ac93204e",
  "Carpenter": "9b59247c-5890-4290-b94e-485ff28bb3c6",
  "Weidlein": "5cda40f0-6d2f-4853-8eb8-b0d7c1cb0f69",
  "Weidlein substantial": "5cda40f0-6d2f-4853-8eb8-b0d7c1cb0f69",
  "Weidlein final": "5cda40f0-6d2f-4853-8eb8-b0d7c1cb0f69",
  "Dougherty": "6021d4a6-7e8a-4df5-b4d0-420583cf1415",
  "Dougherty rough": "6021d4a6-7e8a-4df5-b4d0-420583cf1415",
  "38 Boardman": "489fbf39-bd7c-43ff-8ed6-343de7d7a9fd",
  "Turner deposit": "251841eb-65fa-43c2-b467-3cacb4a81574",
  "Turner start of work": "251841eb-65fa-43c2-b467-3cacb4a81574",
  "Turner framing, skylights and rough electrical": "251841eb-65fa-43c2-b467-3cacb4a81574",
  "Frechette finishes": "a8e0d822-9b7e-4c7f-9dfd-995dc7b0506e",
  "Frechette final": "a8e0d822-9b7e-4c7f-9dfd-995dc7b0506e",
  "Rand rough + permit change order": "d2045290-aacd-4a0c-8170-da70ddc8934a",
  "Rand tile and plaster": "d2045290-aacd-4a0c-8170-da70ddc8934a",
  "Kane rough": "49f9ff50-76f7-43c8-afbc-e3679a33248d",
  "O’Mealia signed change orders": "f9a79d55-2852-4746-b4eb-856f56ed8d6f",
  "Pelkey framed draw": "4f48be06-9754-409b-9819-158ee59f15e1",
  "Pelkey substantial and final": "4f48be06-9754-409b-9819-158ee59f15e1",
  "Harmon framing and steel": "dc0e4486-88d7-4a99-83c3-0459a1b992f5",
  "O’Neill rough": "c8797bfd-0521-4e96-893b-3a3b58fe07f0",
  "Haight rough": "e310f715-4d60-4636-bc21-a8d3c5952649",
  "Haight tile": "e310f715-4d60-4636-bc21-a8d3c5952649",
  "Dresser final": "6e9d3db3-48cd-4511-a4f2-2a13726d3d4b",
  "Puleo": "e2eb8f9d-047d-4b99-b62f-0301e51d60c3",
  "LaPointe": "c6e28677-095c-450c-993c-9d5454d4d1fb",
  "Porter": "e2901aec-de08-4bf4-87ff-d746b52ae596",
  "McNamara chimney repair": "2663e3eb-e1d6-455a-85e5-b15d2a514190",
};

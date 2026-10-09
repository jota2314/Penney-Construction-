import "server-only";

/** Dated management plan transcribed from Jorge's sent team email, not a live receivables forecast.
 * Replace with a newer sourced plan explicitly; never roll these targets into another week/month.
 * All amounts are cents. Reported collections are the email's snapshot, not verified live receipts.
 */
export const publishedCollectionPlan = {
  month: "October 2026",
  asOf: "2026-10-09",
  source: {
    messageId: "1a121aa050ec68dd",
    sentAt: "2026-10-09T17:15:52Z",
    author: "Jorge Betancur",
    subject: "Penney Construction | October collections, week of Oct 12 | Goal: $500,000+",
    url: "https://mail.google.com/mail/u/?authuser=jbetancur%40penneyconstructioninc.com#all/1a121aa050ec68dd",
  },
  goal: 50000000,
  reportedCollected: 13470096,
  monthPlan: 53765315,
  focusWeek: "October 12–16, 2026",
  focusWeekTarget: 20412509,
  invoiced: 8907855,
  readyToBill: 11504654,
  weeks: [
    { label: "Through October 2", amount: 3211506, status: "Reported collected" },
    { label: "October 5–9", amount: 10258590, status: "Reported collected" },
    { label: "October 12–16", amount: 20412509, status: "Target" },
    { label: "October 19–23", amount: 7892587, status: "Target" },
    { label: "October 26–31", amount: 11990123, status: "Target" },
  ],
  managers: [
    { name: "Howie", total: 6605858, items: [
      { project: "Frechette", amount: 2566998, status: "Invoiced", action: "Invoiced 10/5. Carol reviewing credits. Get CO #2 and #3 signed." },
      { project: "Conway", amount: 1492710, status: "Invoiced", action: "Due 10/10. Follow up Tuesday if not in." },
      { project: "White", amount: 1051774, status: "Invoiced", action: "Due 10/10. Follow up Tuesday if not in." },
      { project: "White final", amount: 910033, status: "Ready to bill", action: "Final $5,175 + signed COs #2 and #5. Confirm finals passed and punch done." },
      { project: "Arnott", amount: 584343, status: "Invoiced", action: "Invoiced 10/5. Check at the walkthrough, Thu 10/15 at 9." },
    ] },
    { name: "Bill", total: 9651243, items: [
      { project: "O’Mealia", amount: 6076883, status: "Ready to bill", action: "Rough draw $52,470.33 + signed COs $8,298.50. Confirm rough inspections passed." },
      { project: "Kane", amount: 1488510, status: "Invoiced", action: "Invoiced 9/22. Deposit. Lauren and Jason reviewing the updated design." },
      { project: "Jackling", amount: 1319900, status: "Ready to bill", action: "CO #1, signed 9/17. Rough draw follows the 10/16 inspections." },
      { project: "Ouellette", amount: 765950, status: "Ready to bill", action: "8 COs signed since 9/16." },
    ] },
    { name: "Ryan", total: 3104978, items: [
      { project: "Carpenter", amount: 1381458, status: "Ready to bill", action: "Substantial completion after the final inspection Wed 10/14." },
      { project: "Puleo", amount: 751650, status: "Invoiced", action: "Invoiced 9/9. Settle the wallpaper repair credit." },
      { project: "32 Franklin", amount: 508570, status: "Invoiced", action: "Invoice #3216. Followed up 9/25 and 10/5, no reply." },
      { project: "LaPointe", amount: 463300, status: "Invoiced", action: "Invoiced 9/9. Pays once the extra work is done. Front door estimate and floor plan going out." },
    ] },
    { name: "PM to assign", total: 1050430, items: [
      { project: "Dougherty", amount: 839430, status: "Ready to bill", action: "Deposit. Signed contract received." },
      { project: "Howcroft", amount: 211000, status: "Ready to bill", action: "Ceiling work complete." },
    ] },
  ],
  comingUp: [
    { label: "October 19–23", items: [
      { project: "Jackling rough", amount: 2852300 },
      { project: "Rand start — needs a start date", amount: 2107678 },
      { project: "Weidlein mid", amount: 1412400 },
      { project: "Danti final", amount: 1067667 },
      { project: "Carpenter holdback", amount: 452542 },
    ] },
    { label: "October 26–31", items: [
      { project: "Harmon foundation", amount: 3587040 },
      { project: "O’Neill rough", amount: 2440860 },
      { project: "Frechette finishes", amount: 2371998 },
      { project: "Dresser floors and final", amount: 1422215 },
      { project: "Haight rough", amount: 1328580 },
      { project: "Dougherty start", amount: 839430 },
    ] },
  ],
  conditional: [
    { project: "Pedersen framing draw — at framing inspection", amount: 13487600 },
    { project: "Ouellette acceleration", amount: 7500000 },
  ],
  unsignedChangeOrders: "O’Mealia #10 make-up air $13,972.50 (out since 9/14); Ouellette #24 $6,077.75 and #28 $833.75; Jackling #2 $2,000; Frechette #2 $375 and #3 $441.",
  note: "Monday is Columbus Day, so checks start landing Tuesday. PMs should report completed milestones the same day so invoices can go out that day. Nicole is watching for checks.",
} as const;

export type PublishedCollectionPlan = typeof publishedCollectionPlan;

// Verified Penney project identities for this dated plan. Invoices are fetched
// by these IDs, never matched by a loose client name or a coincidental amount.
export const collectionPlanProjectIds: Record<string, string> = {
  "Frechette": "a8e0d822-9b7e-4c7f-9dfd-995dc7b0506e",
  "Conway": "b12ec6da-a6ca-4d9e-92ae-80c334c49517",
  "White": "c8cbf52a-0be5-4833-afb4-b202c0c06f57",
  "White final": "c8cbf52a-0be5-4833-afb4-b202c0c06f57",
  "Arnott": "2bf7f8d2-d153-40c2-8c84-95d64c0cb50d",
  "O’Mealia": "f9a79d55-2852-4746-b4eb-856f56ed8d6f",
  "Kane": "49f9ff50-76f7-43c8-afbc-e3679a33248d",
  "Jackling": "e3ad2c0a-0d92-4489-a447-c501ac93204e",
  "Ouellette": "683fd513-00d9-4779-93bc-8292483980ec",
  "Carpenter": "9b59247c-5890-4290-b94e-485ff28bb3c6",
  "Puleo": "e2eb8f9d-047d-4b99-b62f-0301e51d60c3",
  "32 Franklin": "37eca944-0c5f-4bea-a066-7bb72e5b6611",
  "LaPointe": "c6e28677-095c-450c-993c-9d5454d4d1fb",
  "Dougherty": "6021d4a6-7e8a-4df5-b4d0-420583cf1415",
  "Howcroft": "96cd5590-a163-463f-849a-02376ab362eb",
  "Jackling rough": "e3ad2c0a-0d92-4489-a447-c501ac93204e",
  "Rand start — needs a start date": "d2045290-aacd-4a0c-8170-da70ddc8934a",
  "Weidlein mid": "5cda40f0-6d2f-4853-8eb8-b0d7c1cb0f69",
  "Danti final": "478e30e9-9b42-4332-9dea-eecd317caff2",
  "Carpenter holdback": "9b59247c-5890-4290-b94e-485ff28bb3c6",
  "Harmon foundation": "dc0e4486-88d7-4a99-83c3-0459a1b992f5",
  "O’Neill rough": "c8797bfd-0521-4e96-893b-3a3b58fe07f0",
  "Frechette finishes": "a8e0d822-9b7e-4c7f-9dfd-995dc7b0506e",
  "Dresser floors and final": "6e9d3db3-48cd-4511-a4f2-2a13726d3d4b",
  "Haight rough": "e310f715-4d60-4636-bc21-a8d3c5952649",
  "Dougherty start": "6021d4a6-7e8a-4df5-b4d0-420583cf1415",
  "Pedersen framing draw — at framing inspection": "e0577c2f-1f24-406e-82fd-a59519294959",
  "Ouellette acceleration": "683fd513-00d9-4779-93bc-8292483980ec",
};

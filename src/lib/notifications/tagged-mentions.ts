import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { sendPushToUser } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { SPEND_HELP_RESPONDER_EMAILS } from "@/lib/auth/role-access";
import {
  applyTestModeRecipients,
  isNotificationTestMode,
  testModeSubject,
} from "@/lib/notifications/test-mode";

export type MentionSource =
  | "company_post"
  | "daily_log"
  | "project_update"
  | "feed_comment"
  | "field_invoice"
  | "client_payment"
  | "bill_pay_approval"
  | "spend_help";

type NotifyTaggedProfilesInput = {
  actorId: string;
  actorName: string;
  recipientProfileIds: string[];
  sourceType: MentionSource;
  sourceId: string;
  title: string;
  body: string;
  url: string;
};

function emailSafeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

type SenderProfile = { id: string; google_refresh_token: string | null };

/**
 * Resolve a Gmail access token for notification emails WITHOUT touching
 * cookies — the acting user may not have Google connected (crew, impersonated
 * sessions), and this can run outside a request context. Prefer the actor's
 * own connected account (so the email comes from them), then fall back to any
 * teammate with a stored refresh token so the email still goes out.
 * Shared by mention notifications and schedule-phase notifications.
 */
export async function getServerGmailAccessToken(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
): Promise<string | null> {
  const { data: senders } = await admin
    .from("profiles")
    .select("id, google_refresh_token")
    .not("google_refresh_token", "is", null);

  const ordered = [...((senders as SenderProfile[] | null) ?? [])].sort(
    (a, b) => Number(b.id === actorId) - Number(a.id === actorId),
  );

  for (const sender of ordered) {
    if (!sender.google_refresh_token) continue;
    const token = await getAccessTokenFromRefreshToken(
      sender.google_refresh_token,
    );
    if (token) return token;
  }
  return null;
}

type RecipientProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type NotificationDelivery = {
  profile: RecipientProfile;
  /**
   * app_notifications.kind — 'mention' for tagged people, 'post' for the
   * whole-team broadcast, 'invoice' for a receipt captured in the field.
   */
  kind: "mention" | "post" | "invoice" | "help";
  title: string;
  /** Lead line of the notification email, e.g. "Jorge tagged you in a …:". */
  emailLead: string;
};

/**
 * Persist the in-app notifications first, then fan out push and email as
 * best-effort delivery channels. A missing VAPID key or Google token never
 * blocks a post.
 */
async function deliverNotifications(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    actorId: string;
    deliveries: NotificationDelivery[];
    sourceType: MentionSource;
    sourceId: string;
    body: string;
    url: string;
    /**
     * Whose mailbox the email should come from, when that differs from who
     * performed the action — a crew member capturing a receipt has no Google
     * account, so the email sends from the office. Defaults to the actor.
     */
    senderProfileId?: string;
    /**
     * A photo to show inside the email body rather than as a download —
     * the receipt itself, so Nicole can check the number without clicking
     * through to the app.
     */
    inlineImage?: { base64: string; mimeType: string; filename: string };
  },
): Promise<void> {
  const { actorId, deliveries, sourceType, sourceId, body, url } = args;
  if (deliveries.length === 0) return;

  const notifications = deliveries.map(({ profile, kind, title }) => ({
    recipient_profile_id: profile.id,
    actor_profile_id: actorId,
    kind,
    title,
    body: body.slice(0, 500),
    url,
    source_type: sourceType,
    source_id: sourceId,
  }));

  const { error: notificationError } = await admin
    .from("app_notifications")
    .upsert(notifications, {
      onConflict: "recipient_profile_id,source_type,source_id",
      ignoreDuplicates: true,
    });
  if (notificationError) {
    console.error("[feed-notifications] Could not persist notifications", {
      sourceType,
      sourceId,
      error: notificationError.message,
    });
  }

  // One token for the whole fan-out — resolved server-side so the email
  // ALWAYS sends, even when the actor never connected Google.
  const accessToken = await getServerGmailAccessToken(
    admin,
    args.senderProfileId ?? actorId,
  );
  if (!accessToken) {
    console.error(
      "[feed-notifications] No connected Google account available — notification emails skipped",
      { sourceType, sourceId },
    );
  }

  const appBaseUrl =
    process.env.APP_BASE_URL ?? "https://www.penneyconstruction.build";

  // cid: is the only embed Gmail honours — a data: URI in <img> gets stripped.
  const inlineImage = args.inlineImage;
  const imageCid = inlineImage ? `photo-${sourceId}` : null;
  const imageHtml = imageCid
    ? `\n\n<img src="cid:${imageCid}" alt="" style="max-width: 360px; width: 100%; border-radius: 8px; border: 1px solid #ddd;" />`
    : "";
  const imageAttachments = inlineImage && imageCid
    ? [
        {
          filename: inlineImage.filename,
          mimeType: inlineImage.mimeType,
          content: inlineImage.base64,
          contentId: imageCid,
          inline: true,
        },
      ]
    : undefined;

  await Promise.allSettled(
    deliveries.map(async ({ profile, title, emailLead }) => {
      await Promise.allSettled([
        sendPushToUser(admin, profile.id, {
          title,
          body: body.slice(0, 120),
          url,
          tag: `${sourceType}-${sourceId}`,
        }).catch((err) => {
          console.error("[feed-notifications] Push failed", {
            recipient: profile.id,
            sourceType,
            sourceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
        accessToken && profile.email
          ? sendEmailWithAccessToken(
              {
                to: profile.email,
                subject: title,
                body: `Hi ${emailSafeText(profile.full_name?.split(" ")[0] || "there")},

${emailSafeText(emailLead)}

${emailSafeText(body.slice(0, 500))}${imageHtml}

Open the app to view it: ${emailSafeText(`${appBaseUrl}${url}`)}`,
                attachments: imageAttachments,
              },
              accessToken,
            ).catch((err) => {
              console.error("[feed-notifications] Email failed", {
                recipient: profile.email,
                sourceType,
                sourceId,
                error: err instanceof Error ? err.message : String(err),
              });
            })
          : Promise.resolve(),
      ]);
    }),
  );
}

/**
 * Notify ONLY the explicitly @tagged profiles (in-app + push + email).
 * Used by feed comments and project updates, where an untagged teammate
 * shouldn't be pinged.
 */
export async function notifyTaggedProfiles({
  actorId,
  actorName,
  recipientProfileIds,
  sourceType,
  sourceId,
  title,
  body,
  url,
}: NotifyTaggedProfilesInput): Promise<void> {
  const recipientIds = Array.from(new Set(recipientProfileIds)).filter(
    (profileId) => profileId !== actorId,
  );
  if (recipientIds.length === 0) return;

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("id", recipientIds);

  const deliveries: NotificationDelivery[] = (profiles ?? []).map(
    (profile) => ({
      profile,
      kind: "mention",
      title,
      emailLead: `${actorName} tagged you in a Penney Construction update:`,
    }),
  );

  await deliverNotifications(admin, {
    actorId,
    deliveries,
    sourceType,
    sourceId,
    body,
    url,
  });
}

/**
 * The office staff who must see every receipt captured in the field.
 * Hardcoded emails match the house pattern (RYAN_EMAIL in send-client-invoice
 * etc.) and, unlike a role filter, cannot silently pick up new owners.
 * Resolved to profile ids at send time -- never matched on full_name, since
 * there are two "Jorge Betancur" profile rows.
 */
const FIELD_INVOICE_WATCHERS = [
  "jbetancur@penneyconstructioninc.com",
  "nsmith@penneyconstructioninc.com",
  "rpenney@penneyconstructioninc.com",
] as const;

/**
 * Ryan asked to come off the automated receipt emails (Jorge 9/2). A receipt
 * is proof of money already spent, so it is Nicole's to book, not his to act
 * on. He still gets invoices — those are pay-approval requests he answers.
 */
const RECEIPT_ONLY_SKIP = new Set<string>(["rpenney@penneyconstructioninc.com"]);

type NotifyFieldInvoiceInput = {
  /** Profile id of whoever snapped the photo. Never notified about their own capture. */
  actorId: string;
  actorName: string;
  /** invoices.id — the notification's dedup key, so one capture pings once. */
  invoiceId: string;
  vendorName: string;
  amount: number | null;
  projectLabel: string;
  /** Set when the AI was not confident; drives the "needs a look" wording. */
  reviewReason?: string | null;
  /**
   * What the document IS. A receipt is proof of a payment already made; an
   * invoice is an unpaid bill sitting in A/P. Calling an invoice a "receipt"
   * makes people think money already left (Jorge 8/20). Defaults to receipt
   * for old callers.
   */
  docKind?: "receipt" | "invoice";
  url: string;
  /** The receipt itself, shown in the email body. Already a compressed JPEG. */
  photo?: { base64: string; mimeType: string } | null;
};

/**
 * Tell Jorge and Nicole (plus Ryan for invoices only) that a receipt or invoice was captured
 * (in-app + push + email). Flagged captures say so in the subject line so
 * Nicole can spot the ones that actually need her before opening anything.
 */
export async function notifyFieldInvoiceCaptured({
  actorId,
  actorName,
  invoiceId,
  vendorName,
  amount,
  projectLabel,
  reviewReason,
  docKind = "receipt",
  url,
  photo,
}: NotifyFieldInvoiceInput): Promise<void> {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("email", [...FIELD_INVOICE_WATCHERS]);

  // Test mode narrows the watchers to the tester before anything is sent, so
  // walking the bill flow never mails Nicole or Ryan.
  const testMode = await isNotificationTestMode(admin);
  const recipients = applyTestModeRecipients(
    ((profiles as RecipientProfile[] | null) ?? []).filter(
      (profile) =>
        profile.id !== actorId &&
        !(docKind === "receipt" && RECEIPT_ONLY_SKIP.has(profile.email ?? "")),
    ),
    testMode,
  );
  if (recipients.length === 0) return;

  const money =
    typeof amount === "number" && Number.isFinite(amount)
      ? `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "amount not read";

  const needsReview = Boolean(reviewReason);
  const noun = docKind === "invoice" ? "invoice" : "receipt";
  // An invoice is an approval request, not an FYI: the PM filed it, Jorge or
  // Ryan approves it for pay, Nicole pays it (Jorge 8/20).
  const rawTitle = (
    needsReview
      ? `Check this ${noun}: ${vendorName} ${money} - ${projectLabel}`
      : docKind === "invoice"
        ? `Ready for pay approval: ${vendorName} ${money} - ${projectLabel}`
        : `Receipt filed: ${vendorName} ${money} - ${projectLabel}`
  ).slice(0, 200);
  const title = testMode ? testModeSubject(rawTitle) : rawTitle;

  const unpaidTail =
    docKind === "invoice" ? " It is unpaid. Open it in the app and approve it for pay." : "";
  const body = (
    needsReview
      ? `${actorName} captured a ${vendorName} ${noun} for ${money} on ${projectLabel}. It needs a look: ${reviewReason}`
      : `${actorName} filed a ${vendorName} ${noun} for ${money} on ${projectLabel}.${unpaidTail}`
  ).slice(0, 500);

  const deliveries: NotificationDelivery[] = recipients.map((profile) => ({
    profile,
    kind: "invoice",
    title,
    emailLead: needsReview
      ? `A ${noun} needs checking:`
      : docKind === "invoice"
        ? "An invoice is ready for your approval to pay:"
        : "A receipt was captured in the field:",
  }));

  // Send from Jorge's mailbox — the crew member who took the photo has no
  // Google account. The capture is still credited to them via actorId.
  const jorge = ((profiles as RecipientProfile[] | null) ?? []).find(
    (profile) => profile.email === FIELD_INVOICE_WATCHERS[0],
  );

  await deliverNotifications(admin, {
    actorId,
    senderProfileId: jorge?.id ?? actorId,
    deliveries,
    sourceType: "field_invoice",
    sourceId: invoiceId,
    body,
    url,
    inlineImage: photo
      ? { base64: photo.base64, mimeType: photo.mimeType, filename: `${noun}.jpg` }
      : undefined,
  });
}

/**
 * A bill was approved for pay. Nicole gets the email (she cuts the check)
 * with Jorge and Ryan on CC so the approval is on the record in everyone's
 * mailbox (Jorge 8/20) — a custom email with the bill's details, not the
 * generic notification template. Nicole also gets the in-app + push ping.
 */
export async function notifyBillApprovedForPay({
  actorId,
  actorName,
  invoiceId,
  vendorName,
  amount,
  projectLabel,
  invoiceNumber,
  dueDate,
  url,
}: {
  actorId: string;
  actorName: string;
  invoiceId: string;
  vendorName: string;
  amount: number | null;
  projectLabel: string;
  invoiceNumber?: string | null;
  dueDate?: string | null;
  url: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("email", [
      "nsmith@penneyconstructioninc.com",
      "jbetancur@penneyconstructioninc.com",
      "rpenney@penneyconstructioninc.com",
    ]);
  const all = (profiles as RecipientProfile[] | null) ?? [];

  // In test mode the approval notice goes to the tester instead of Nicole, and
  // Ryan drops off the CC — approving a test bill must not tell the office to
  // cut a check. `nicole` is the To of the real email, so redirecting it here
  // covers the in-app notification, the push and the email in one move.
  const testMode = await isNotificationTestMode(admin);
  const tester = all.find((p) => p.email === "jbetancur@penneyconstructioninc.com");
  const nicole = testMode
    ? tester
    : all.find((p) => p.email === "nsmith@penneyconstructioninc.com");

  const money =
    typeof amount === "number" && Number.isFinite(amount)
      ? `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "amount not read";

  const rawTitle = `Approved for pay: ${vendorName} ${money} - ${projectLabel}`.slice(0, 200);
  const title = testMode ? testModeSubject(rawTitle) : rawTitle;
  const appBaseUrl = process.env.APP_BASE_URL ?? "https://www.penneyconstruction.build";

  // In-app + push for Nicole only; the email below covers everyone.
  if (nicole && nicole.id !== actorId) {
    await admin
      .from("app_notifications")
      .upsert(
        [
          {
            recipient_profile_id: nicole.id,
            actor_profile_id: actorId,
            kind: "invoice",
            title,
            body: `${actorName} approved the ${vendorName} invoice for ${money} on ${projectLabel}. Good to pay.`.slice(0, 500),
            url,
            source_type: "bill_pay_approval",
            source_id: invoiceId,
          },
        ],
        { onConflict: "recipient_profile_id,source_type,source_id", ignoreDuplicates: true },
      );
    await sendPushToUser(admin, nicole.id, {
      title,
      body: `${actorName} approved ${vendorName} ${money}. Good to pay.`.slice(0, 120),
      url,
      tag: `bill_pay_approval-${invoiceId}`,
    }).catch((err) => {
      console.error("[bill-pay-approval] Push failed", {
        invoiceId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // The custom email: To Nicole, CC Jorge and Ryan — the approver is CC'd on
  // purpose so the record lands in their mailbox too.
  const accessToken = await getServerGmailAccessToken(admin, actorId);
  if (!accessToken || !nicole?.email) {
    console.error("[bill-pay-approval] Email skipped", {
      invoiceId,
      hasToken: Boolean(accessToken),
    });
    return;
  }

  const detailLines = [
    `Vendor: ${vendorName}`,
    `Amount: ${money}`,
    `Job: ${projectLabel}`,
    invoiceNumber ? `Invoice #: ${invoiceNumber}` : null,
    dueDate ? `Due: ${dueDate}` : null,
    `Approved by: ${actorName}`,
  ].filter(Boolean) as string[];

  await sendEmailWithAccessToken(
    {
      to: nicole.email,
      cc: testMode
        ? undefined
        : ["jbetancur@penneyconstructioninc.com", "rpenney@penneyconstructioninc.com"].join(", "),
      subject: title,
      body: `${testMode ? "TEST RUN - notifications are in test mode, so this went to you instead of Nicole. Nobody has been asked to pay anything.\n\n" : ""}Hi ${testMode ? "Jorge" : "Nicole"},

This bill is approved and good to pay.

${detailLines.map(emailSafeText).join("\n")}

Open it in the app: ${emailSafeText(`${appBaseUrl}${url}`)}

Thanks!`,
    },
    accessToken,
  ).catch((err) => {
    console.error("[bill-pay-approval] Email failed", {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

type NotifyClientPaymentInput = {
  /** Profile id of whoever snapped the check. Never notified about their own capture. */
  actorId: string;
  actorName: string;
  /** payments_received.id — the notification's dedup key, so one capture pings once. */
  paymentId: string;
  payerName: string;
  amount: number;
  /** deposit | draw | progress | final | change_order | retainage | other. */
  paymentType: string;
  projectLabel: string;
  /** Set when the AI was not confident; drives the "needs a look" wording. */
  reviewReason?: string | null;
  url: string;
  /** The check itself, shown in the email body. Already a compressed JPEG. */
  photo?: { base64: string; mimeType: string } | null;
};

/**
 * Money IN, mirroring notifyFieldInvoiceCaptured. Same three watchers: Nicole
 * books it, Ryan wants to know the cash landed, Jorge reconciles it against the
 * ledger. Nobody should have to be told a client paid.
 */
export async function notifyClientPaymentCaptured({
  actorId,
  actorName,
  paymentId,
  payerName,
  amount,
  paymentType,
  projectLabel,
  reviewReason,
  url,
  photo,
}: NotifyClientPaymentInput): Promise<void> {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("email", [...FIELD_INVOICE_WATCHERS]);

  const recipients = ((profiles as RecipientProfile[] | null) ?? []).filter(
    (profile) => profile.id !== actorId,
  );
  if (recipients.length === 0) return;

  const money = `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const label = paymentType.replace(/_/g, " ");

  const needsReview = Boolean(reviewReason);
  const title = (
    needsReview
      ? `Check this payment: ${money} from ${payerName} - ${projectLabel}`
      : `Payment received: ${money} from ${payerName} - ${projectLabel}`
  ).slice(0, 200);

  const body = (
    needsReview
      ? `${actorName} logged a ${label} of ${money} from ${payerName} on ${projectLabel}. It needs a look: ${reviewReason}`
      : `${actorName} logged a ${label} of ${money} from ${payerName} on ${projectLabel}.`
  ).slice(0, 500);

  const deliveries: NotificationDelivery[] = recipients.map((profile) => ({
    profile,
    kind: "invoice",
    title,
    emailLead: needsReview
      ? "A client payment was logged and needs checking:"
      : "A client payment was logged:",
  }));

  // Send from Jorge's mailbox — whoever photographed the check may have no
  // Google account. The capture is still credited to them via actorId.
  const jorge = ((profiles as RecipientProfile[] | null) ?? []).find(
    (profile) => profile.email === FIELD_INVOICE_WATCHERS[0],
  );

  await deliverNotifications(admin, {
    actorId,
    senderProfileId: jorge?.id ?? actorId,
    deliveries,
    sourceType: "client_payment",
    sourceId: paymentId,
    body,
    url,
    inlineImage: photo
      ? { base64: photo.base64, mimeType: photo.mimeType, filename: "payment.jpg" }
      : undefined,
  });
}

type NotifyTeamOfFeedPostInput = {
  actorId: string;
  actorName: string;
  /** Profiles explicitly @tagged in the post — they get the "tagged you" variant. */
  taggedProfileIds: string[];
  sourceType: Extract<MentionSource, "company_post" | "daily_log">;
  sourceId: string;
  /** Notification title for tagged recipients, e.g. "Jorge tagged you". */
  taggedTitle: string;
  /** Notification title for everyone else, e.g. "Jorge posted an update". */
  postTitle: string;
  body: string;
  url: string;
};

/**
 * Notify the WHOLE team about a new feed post (in-app + push + email), not
 * just the @tagged profiles — a post with no tags used to notify no one.
 * Tagged teammates keep the "tagged you" mention variant; everyone else gets
 * the "posted an update" variant (kind='post'). The author is never notified,
 * and the unique (recipient, source_type, source_id) key keeps it to one
 * notification per person per post.
 */
export async function notifyTeamOfFeedPost({
  actorId,
  actorName,
  taggedProfileIds,
  sourceType,
  sourceId,
  taggedTitle,
  postTitle,
  body,
  url,
}: NotifyTeamOfFeedPostInput): Promise<void> {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name");

  const tagged = new Set(taggedProfileIds);
  const deliveries: NotificationDelivery[] = (
    (profiles as RecipientProfile[] | null) ?? []
  )
    .filter((profile) => profile.id !== actorId)
    .map((profile) =>
      tagged.has(profile.id)
        ? {
            profile,
            kind: "mention" as const,
            title: taggedTitle,
            emailLead: `${actorName} tagged you in a Penney Construction update:`,
          }
        : {
            profile,
            kind: "post" as const,
            title: postTitle,
            emailLead: `${actorName} posted a new update in the Penney Construction app:`,
          },
    );

  await deliverNotifications(admin, {
    actorId,
    deliveries,
    sourceType,
    sourceId,
    body,
    url,
  });
}


/**
 * Nicole hit a cost she cannot place and tapped "Ask for help".
 *
 * This is a QUESTION, not an FYI: the answer lives in the estimates, so it
 * goes to the people who wrote them (SPEND_HELP_RESPONDER_EMAILS — Jorge and
 * Ryan). The link drops them on the spend organizer focused on that exact
 * row, where they set the job + budget line themselves. Whoever answers
 * first clears it for both.
 */
export async function notifySpendHelpRequested({
  actorId,
  actorName,
  invoiceId,
  vendorName,
  amount,
  spentOn,
  note,
  url,
}: {
  actorId: string;
  actorName: string;
  invoiceId: string;
  vendorName: string;
  amount: number | null;
  spentOn: string | null;
  note: string | null;
  url: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("email", [...SPEND_HELP_RESPONDER_EMAILS]);

  const recipients = ((profiles as RecipientProfile[] | null) ?? []).filter(
    (profile) => profile.id !== actorId,
  );
  if (recipients.length === 0) return;

  const money =
    typeof amount === "number" && Number.isFinite(amount)
      ? `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "amount not read";

  const title = `Which job? ${vendorName} ${money}`.slice(0, 200);
  const body = [
    `${actorName} needs the job and budget line for a ${vendorName} charge of ${money}`,
    spentOn ? ` from ${spentOn}` : "",
    ".",
    note ? ` They added: "${note}"` : "",
    " Open it and set the line — it saves straight to the books.",
  ]
    .join("")
    .slice(0, 500);

  await deliverNotifications(admin, {
    actorId,
    deliveries: recipients.map((profile) => ({
      profile,
      kind: "help" as const,
      title,
      emailLead: `${actorName} needs a hand placing a cost:`,
    })),
    sourceType: "spend_help",
    sourceId: invoiceId,
    body,
    url,
  });
}

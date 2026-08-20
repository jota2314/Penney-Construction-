import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { sendPushToUser } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";

export type MentionSource =
  | "company_post"
  | "daily_log"
  | "project_update"
  | "feed_comment"
  | "field_invoice"
  | "client_payment"
  | "bill_pay_approval";

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
  kind: "mention" | "post" | "invoice";
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
 * Tell Jorge, Nicole and Ryan that a receipt or invoice was captured
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

  const recipients = ((profiles as RecipientProfile[] | null) ?? []).filter(
    (profile) => profile.id !== actorId,
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
  const title = (
    needsReview
      ? `Check this ${noun}: ${vendorName} ${money} - ${projectLabel}`
      : docKind === "invoice"
        ? `Ready for pay approval: ${vendorName} ${money} - ${projectLabel}`
        : `Receipt filed: ${vendorName} ${money} - ${projectLabel}`
  ).slice(0, 200);

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
 * A bill was approved for pay — tell Nicole it's good to go. One recipient by
 * design: she's the one who cuts the check; Jorge/Ryan just approved it and
 * the PM who filed it doesn't need a ping.
 */
export async function notifyBillApprovedForPay({
  actorId,
  actorName,
  invoiceId,
  vendorName,
  amount,
  projectLabel,
  url,
}: {
  actorId: string;
  actorName: string;
  invoiceId: string;
  vendorName: string;
  amount: number | null;
  projectLabel: string;
  url: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", "nsmith@penneyconstructioninc.com");

  const recipients = ((profiles as RecipientProfile[] | null) ?? []).filter(
    (profile) => profile.id !== actorId,
  );
  if (recipients.length === 0) return;

  const money =
    typeof amount === "number" && Number.isFinite(amount)
      ? `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "amount not read";

  const title = `Approved for pay: ${vendorName} ${money} - ${projectLabel}`.slice(0, 200);
  const body =
    `${actorName} approved the ${vendorName} invoice for ${money} on ${projectLabel}. Good to pay.`.slice(0, 500);

  const deliveries: NotificationDelivery[] = recipients.map((profile) => ({
    profile,
    kind: "invoice",
    title,
    emailLead: "A bill was approved for payment:",
  }));

  await deliverNotifications(admin, {
    actorId,
    deliveries,
    sourceType: "bill_pay_approval",
    sourceId: invoiceId,
    body,
    url,
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

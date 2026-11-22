/**
 * Quo (formerly OpenPhone) webhook payloads, API version 2026-03-30, mapped
 * onto `sms_messages` / `phone_calls` rows.
 *
 * Pure functions only (no DB, no env, no imports) so the mapping and the
 * matching rules can be checked without a server.
 */

export const QUO_PROVIDER = "quo" as const;

export type QuoContext = {
  orgId?: string | null;
  phoneNumberId?: string | null;
  conversationId?: string | null;
  phoneNumberType?: string | null;
  userId?: string | null;
  contacts?: { ids?: string[]; lookupStatus?: string } | null;
  /** Messages: usually E.164 numbers. */
  senderIdentifier?: string | null;
  recipientIdentifiers?: string[] | null;
  /** Calls: our numbers vs. the outside party's. */
  participants?: {
    workspace?: string[];
    external?: string[];
    resolution?: string;
  } | null;
};

export type QuoEnvelope = {
  id: string | null;
  type: string;
  createdAt: string | null;
  resource: Record<string, unknown>;
  context: QuoContext;
  quoUrl: string | null;
};

const UNKNOWN_NUMBER = "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iso(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => str(entry))
    .filter((entry): entry is string => Boolean(entry));
}

/** Parse a verified raw body. Null means "not an event we understand". */
export function parseQuoEnvelope(rawBody: string): QuoEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const type = str(parsed.type);
  const data = parsed.data;
  if (!type || !isRecord(data) || !isRecord(data.resource)) return null;

  return {
    id: str(parsed.id),
    type,
    createdAt: iso(parsed.createdAt),
    resource: data.resource,
    context: isRecord(data.context) ? (data.context as QuoContext) : {},
    quoUrl: isRecord(data.links) ? str(data.links.quo) : null,
  };
}

/**
 * Last 10 digits: the only reliable way to compare US numbers across
 * +1 / dashes / parens. Empty when the value is not a full phone number
 * (short codes, internal identifiers), so those never match a contact.
 */
export function phoneKey(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

export type DbDirection = "inbound" | "outbound";

function dbDirection(value: unknown): DbDirection | null {
  if (value === "incoming") return "inbound";
  if (value === "outgoing") return "outbound";
  return null;
}

type SharedColumns = {
  provider: typeof QUO_PROVIDER;
  external_id: string;
  conversation_id: string | null;
  line_id: string | null;
  external_user_id: string | null;
  external_url: string | null;
  is_allowed: true;
};

function sharedColumns(event: QuoEnvelope, externalId: string): SharedColumns {
  return {
    provider: QUO_PROVIDER,
    external_id: externalId,
    conversation_id: str(event.context.conversationId),
    line_id: str(event.context.phoneNumberId),
    external_user_id: str(event.context.userId),
    external_url: event.quoUrl,
    is_allowed: true,
  };
}

// ---------------------------------------------------------------- messages

export const QUO_MESSAGE_EVENTS = [
  "message.received",
  "message.delivered",
  "message.failed",
  "message.undelivered",
] as const;

export type QuoMessageRow = SharedColumns & {
  direction: DbDirection;
  from_number: string;
  to_number: string;
  recipients: string[];
  body: string;
  media: { type: string | null; url: string }[];
  status: string;
  occurred_at: string | null;
};

export type QuoMessageWrite = {
  externalId: string;
  /** Applied when the message is already stored: only the status moves. */
  patch: { status: string };
  /** The full row for a message we have not seen. */
  row: QuoMessageRow;
  /** The outside party's number(s), for contact matching. */
  counterparts: string[];
};

export function messageWriteFromEvent(
  event: QuoEnvelope,
): QuoMessageWrite | null {
  if (!(QUO_MESSAGE_EVENTS as readonly string[]).includes(event.type)) {
    return null;
  }

  const externalId = str(event.resource.id);
  const direction =
    dbDirection(event.resource.direction) ??
    (event.type === "message.received" ? "inbound" : "outbound");
  if (!externalId) return null;

  const sender = str(event.context.senderIdentifier);
  const recipients = strings(event.context.recipientIdentifiers);
  const status =
    str(event.resource.status) ?? event.type.slice("message.".length);

  const media = Array.isArray(event.resource.media)
    ? event.resource.media
        .filter(isRecord)
        .map((item) => ({ type: str(item.type), url: str(item.url) }))
        .filter((item): item is { type: string | null; url: string } =>
          Boolean(item.url),
        )
    : [];

  return {
    externalId,
    patch: { status },
    row: {
      ...sharedColumns(event, externalId),
      direction,
      from_number: sender ?? UNKNOWN_NUMBER,
      to_number: recipients[0] ?? UNKNOWN_NUMBER,
      recipients,
      body: typeof event.resource.text === "string" ? event.resource.text : "",
      media,
      status,
      occurred_at: iso(event.resource.createdAt) ?? event.createdAt,
    },
    counterparts:
      direction === "inbound" ? (sender ? [sender] : []) : recipients,
  };
}

// ------------------------------------------------------------------- calls

export const QUO_CALL_EVENTS = [
  "call.completed",
  "call.recording.completed",
  "call.summary.completed",
  "call.transcript.completed",
  "call.voicemail.completed",
] as const;

export type QuoCallPatch = {
  direction?: DbDirection;
  from_number?: string;
  to_number?: string;
  status?: string;
  duration_seconds?: number | null;
  answered_at?: string | null;
  completed_at?: string | null;
  occurred_at?: string | null;
  has_voicemail?: boolean;
  recording_sid?: string | null;
  recording_url?: string | null;
  recording_duration?: number | null;
  recordings?: unknown[];
  summary?: string[];
  next_steps?: string[];
  transcript?: string;
  transcript_segments?: unknown[];
  external_url?: string | null;
};

export type QuoCallStub = SharedColumns & {
  direction: DbDirection;
  from_number: string;
  to_number: string;
  occurred_at: string | null;
};

export type QuoCallWrite = {
  externalId: string;
  /** Columns this event is the source of truth for. */
  patch: QuoCallPatch;
  /**
   * The row to create when this is the first event we see for the call.
   * Quo does not guarantee order, so a summary can land before call.completed;
   * its stub guesses inbound and call.completed corrects it.
   */
  stub: QuoCallStub;
  /** The outside party's number(s), for contact matching. */
  counterparts: string[];
};

function callNumbers(
  event: QuoEnvelope,
  direction: DbDirection,
): { from: string; to: string; counterparts: string[] } {
  const ours = strings(event.context.participants?.workspace);
  const theirs = strings(event.context.participants?.external);
  const our = ours[0] ?? UNKNOWN_NUMBER;
  const their = theirs[0] ?? UNKNOWN_NUMBER;
  return direction === "inbound"
    ? { from: their, to: our, counterparts: theirs }
    : { from: our, to: their, counterparts: theirs };
}

export function callWriteFromEvent(event: QuoEnvelope): QuoCallWrite | null {
  if (!(QUO_CALL_EVENTS as readonly string[]).includes(event.type)) return null;
  const resource = event.resource;

  // Summaries, transcripts and voicemails hang off the call by `callId`;
  // call.completed and call.recording.completed carry the call's own `id`.
  const externalId =
    event.type === "call.completed" || event.type === "call.recording.completed"
      ? str(resource.id)
      : (str(resource.callId) ?? str(resource.id));
  if (!externalId) return null;

  const knownDirection = dbDirection(resource.direction);
  const direction = knownDirection ?? "inbound";
  const occurredAt = iso(resource.createdAt) ?? event.createdAt;

  let numbers = callNumbers(event, direction);
  if (event.type === "call.voicemail.completed") {
    // The voicemail payload names both ends itself.
    const from = str(resource.from);
    const to = str(resource.to);
    if (from && to) {
      numbers = {
        from,
        to,
        counterparts: [direction === "inbound" ? from : to],
      };
    }
  }

  const stub: QuoCallStub = {
    ...sharedColumns(event, externalId),
    direction,
    from_number: numbers.from,
    to_number: numbers.to,
    occurred_at: occurredAt,
  };

  let patch: QuoCallPatch;
  switch (event.type) {
    case "call.completed": {
      // Fix a stub's guessed direction, but never replace real numbers with
      // "unknown" when Quo could not resolve the participants.
      const numbersKnown =
        numbers.from !== UNKNOWN_NUMBER && numbers.to !== UNKNOWN_NUMBER;
      patch = {
        ...(knownDirection ? { direction: knownDirection } : {}),
        ...(knownDirection && numbersKnown
          ? { from_number: numbers.from, to_number: numbers.to }
          : {}),
        status: str(resource.status) ?? "unknown",
        duration_seconds: num(resource.duration),
        answered_at: iso(resource.answeredAt),
        completed_at: iso(resource.completedAt),
        occurred_at: occurredAt,
        external_url: event.quoUrl,
        ...(typeof resource.hasVoicemail === "boolean"
          ? { has_voicemail: resource.hasVoicemail }
          : {}),
      };
      break;
    }
    case "call.recording.completed": {
      const recordings = Array.isArray(resource.recordings)
        ? resource.recordings.filter(isRecord)
        : [];
      // An empty array means "no recording metadata in this payload", not
      // "the recording is gone": leave whatever is stored alone.
      if (recordings.length === 0) {
        patch = {};
        break;
      }
      const seconds = recordings
        .map((item) => num(item.duration))
        .filter((value): value is number => value !== null);
      patch = {
        recording_sid: str(recordings[0].id),
        recording_url: str(recordings[0].url),
        recording_duration: seconds.length
          ? Math.round(seconds.reduce((sum, value) => sum + value, 0))
          : null,
        recordings,
      };
      break;
    }
    case "call.summary.completed": {
      const summary = strings(resource.summary);
      const nextSteps = strings(resource.nextSteps);
      patch =
        summary.length || nextSteps.length
          ? { summary, next_steps: nextSteps }
          : {};
      break;
    }
    case "call.transcript.completed": {
      const dialogue = Array.isArray(resource.dialogue)
        ? resource.dialogue.filter(isRecord)
        : [];
      const lines = dialogue
        .map((turn) => {
          const content = str(turn.content);
          if (!content) return null;
          const speaker = str(turn.identifier) ?? str(turn.userId) ?? "Speaker";
          return `${speaker}: ${content}`;
        })
        .filter((line): line is string => Boolean(line));
      patch = lines.length
        ? { transcript: lines.join("\n"), transcript_segments: dialogue }
        : {};
      break;
    }
    default: {
      // call.voicemail.completed
      const transcript = str(resource.transcript);
      const duration = num(resource.duration);
      patch = {
        has_voicemail: true,
        ...(str(resource.recordingUrl)
          ? { recording_url: str(resource.recordingUrl) }
          : {}),
        ...(duration !== null
          ? { recording_duration: Math.round(duration) }
          : {}),
        ...(transcript ? { transcript } : {}),
      };
    }
  }

  return { externalId, patch, stub, counterparts: numbers.counterparts };
}

// ----------------------------------------------------------------- matching

export type PhoneLogContactKind = "employee" | "customer" | "subcontractor";

export type PhoneLogContact = {
  kind: PhoneLogContactKind;
  id: string;
  name: string;
};

export type PhoneDirectoryRow = {
  kind: PhoneLogContactKind;
  id: string;
  name: string;
  phone: string | null;
};

/**
 * First counterpart number that belongs to someone we know. When a number is
 * on more than one record, a teammate wins, then a client, then a sub.
 */
export function pickContact(
  numbers: string[],
  directory: PhoneDirectoryRow[],
): PhoneLogContact | null {
  const order: PhoneLogContactKind[] = ["employee", "customer", "subcontractor"];
  for (const number of numbers) {
    const key = phoneKey(number);
    if (!key) continue;
    for (const kind of order) {
      const hit = directory.find(
        (row) => row.kind === kind && phoneKey(row.phone) === key,
      );
      if (hit) return { kind: hit.kind, id: hit.id, name: hit.name };
    }
  }
  return null;
}

export type ProjectMatch = "single_open" | "single" | "ambiguous" | "none";

export type ProjectCandidate = {
  id: string;
  status: string | null;
  is_overhead?: boolean | null;
};

const CLOSED_PROJECT_STATUSES = new Set(["cancelled", "completed"]);

/**
 * Which job a contact's call or text belongs to. Only ever files it when
 * there is exactly one candidate: one open job, or (with none open) one job
 * in total. Two open jobs means a person picks; guessing would put a
 * client's words on the wrong job.
 */
export function pickProject(candidates: ProjectCandidate[]): {
  projectId: string | null;
  match: ProjectMatch;
} {
  const unique = new Map<string, ProjectCandidate>();
  for (const candidate of candidates) {
    if (!candidate.is_overhead) unique.set(candidate.id, candidate);
  }
  const all = [...unique.values()];
  if (all.length === 0) return { projectId: null, match: "none" };

  const open = all.filter(
    (project) => !CLOSED_PROJECT_STATUSES.has(project.status ?? ""),
  );
  if (open.length === 1) return { projectId: open[0].id, match: "single_open" };
  if (open.length > 1) return { projectId: null, match: "ambiguous" };
  if (all.length === 1) return { projectId: all[0].id, match: "single" };
  return { projectId: null, match: "ambiguous" };
}

"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  Phone,
  PhoneForwarded,
  Send,
  Voicemail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  sendPhoneLineSms,
  type PhoneLineData,
  type PhoneThreadItem,
} from "@/lib/actions/phone-line";

function timeLabel(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return time;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

function dayLabel(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Split MMS "[media] https://…" lines out of a text body. */
function splitBody(body: string): { text: string; mediaUrls: string[] } {
  const mediaUrls: string[] = [];
  const textLines: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("[media] ")) mediaUrls.push(line.slice(8).trim());
    else textLines.push(line);
  }
  return { text: textLines.join("\n").trim(), mediaUrls };
}

function SmsBubble({ item }: { item: PhoneThreadItem }) {
  const inbound = item.direction === "inbound";
  const { text, mediaUrls } = splitBody(item.body ?? "");
  return (
    <div className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%] ${
          inbound
            ? "rounded-bl-sm bg-muted text-foreground"
            : "rounded-br-sm bg-amber-600 text-white"
        }`}
      >
        {text ? <p className="whitespace-pre-wrap break-words">{text}</p> : null}
        {mediaUrls.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className={`mt-1 block text-xs underline underline-offset-2 ${
              inbound ? "text-amber-500" : "text-amber-100"
            }`}
          >
            View attachment
          </a>
        ))}
        <div
          className={`mt-1 flex items-center gap-1.5 text-[10px] tabular-nums ${
            inbound ? "text-muted-foreground" : "text-amber-100/80"
          }`}
        >
          <span>{timeLabel(item.createdAt)}</span>
          {!inbound && item.sentByName ? <span>· {item.sentByName}</span> : null}
          {item.status === "failed" ? (
            <span className="flex items-center gap-1 font-medium text-red-300">
              <AlertTriangle className="h-3 w-3" />
              not delivered{item.errorMessage ? ` — ${item.errorMessage}` : ""}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CallCard({ item }: { item: PhoneThreadItem }) {
  const isVoicemail = item.status === "voicemail";
  const Icon = isVoicemail
    ? Voicemail
    : item.status === "forwarded"
      ? PhoneForwarded
      : Phone;
  const label = isVoicemail
    ? `Voicemail${item.recordingDuration ? ` · ${formatDuration(item.recordingDuration)}` : ""}`
    : item.status === "forwarded"
      ? "Call — forwarded to cell"
      : "Call";

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-2xl rounded-bl-sm border bg-card px-3.5 py-2.5 sm:max-w-[70%]">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-amber-500" />
          <span>{label}</span>
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
            {timeLabel(item.createdAt)}
          </span>
        </div>
        {isVoicemail && item.hasRecording ? (
          <audio
            controls
            preload="none"
            src={`/api/twilio/recording-audio?id=${item.id}`}
            className="mt-2 h-9 w-full"
          />
        ) : null}
        {item.transcript ? (
          <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-amber-500/40 pl-2 text-xs italic text-muted-foreground">
            “{item.transcript}”
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SetupCard({ data }: { data: PhoneLineData }) {
  return (
    <div className="mx-auto w-full max-w-lg rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Phone line not connected yet
      </div>
      <p className="mt-2 text-muted-foreground">
        Add these environment variables in Vercel, then point the Twilio
        number&apos;s webhooks at the app:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>
          <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>,{" "}
          <code>TWILIO_PHONE_NUMBER</code>
        </li>
        <li>
          <code>TWILIO_ALLOWED_NUMBERS</code> — comma-separated cell numbers the
          line talks to (Luis)
        </li>
        <li>
          <code>TWILIO_VOICE_FORWARD_NUMBER</code> — optional; calls ring this
          cell before voicemail
        </li>
        <li>
          Twilio Console → the number → Messaging webhook:{" "}
          <code>/api/twilio/sms</code> · Voice webhook:{" "}
          <code>/api/twilio/voice</code> (both HTTP POST)
        </li>
      </ul>
      {data.allowedContacts.length === 0 && data.configured ? (
        <p className="mt-2 text-xs text-amber-500">
          Credentials are set, but the allowlist is empty — add
          TWILIO_ALLOWED_NUMBERS so someone can get through.
        </p>
      ) : null}
    </div>
  );
}

export function PhoneLine({ data }: { data: PhoneLineData }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState(data.allowedContacts[0]?.number ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const ready = data.configured && data.allowedContacts.length > 0;

  // New texts land via webhook — refresh the server data every 20s while
  // the tab is visible so the thread keeps up without a manual reload.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20000);
    return () => clearInterval(interval);
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data.items.length]);

  const groups = useMemo(() => {
    const byDay: { day: string; items: PhoneThreadItem[] }[] = [];
    for (const item of data.items) {
      const day = dayLabel(item.createdAt);
      const last = byDay[byDay.length - 1];
      if (last && last.day === day) last.items.push(item);
      else byDay.push({ day, items: [item] });
    }
    return byDay;
  }, [data.items]);

  const send = () => {
    if (!draft.trim() || !target || isSending) return;
    setError(null);
    startSending(async () => {
      const result = await sendPhoneLineSms({ to: target, body: draft });
      if (result.ok) {
        setDraft("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-6">
        {!ready ? <SetupCard data={data} /> : null}

        {ready && data.items.length === 0 ? (
          <div className="mx-auto max-w-md pt-10 text-center text-sm text-muted-foreground">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 text-amber-500/60" />
            No calls or texts yet. When{" "}
            {data.allowedContacts.map((c) => c.name).join(" or ")} calls or
            texts {data.phoneNumber ?? "the line"}, it shows up here.
          </div>
        ) : null}

        {groups.map((group) => (
          <div key={group.day} className="space-y-2">
            <div className="sticky top-0 z-10 flex justify-center">
              <span className="rounded-full border bg-background px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {group.day}
              </span>
            </div>
            {group.items.map((item) =>
              item.type === "sms" ? (
                <SmsBubble key={item.id} item={item} />
              ) : (
                <CallCard key={item.id} item={item} />
              ),
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t bg-background p-3 sm:px-6">
        {data.allowedContacts.length > 1 ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            To:
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {data.allowedContacts.map((contact) => (
                <option key={contact.number} value={contact.number}>
                  {contact.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {error ? (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-red-500">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={
              ready
                ? `Text ${
                    data.allowedContacts.find((c) => c.number === target)
                      ?.name ?? data.allowedContacts[0]?.name ?? ""
                  }…`
                : "Finish setup to start texting"
            }
            disabled={!ready || isSending}
            rows={1}
            className="max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border bg-muted/40 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-amber-500/60 disabled:opacity-50"
          />
          <Button
            onClick={send}
            disabled={!ready || isSending || !draft.trim()}
            className="h-[42px] shrink-0 bg-amber-600 text-white hover:bg-amber-700"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="ml-1.5 hidden sm:inline">Send</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

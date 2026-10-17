"use client";

import { useCallback, useRef, useState } from "react";
import type { PortalNoticeValue } from "./notice";

/**
 * Every tap that saves something: one busy key at a time (so a double tap
 * with gloves posts once), an inline notice instead of alert(), and
 * `enabled` off in the staff preview so nothing saves there. Generalized
 * from the client portal's useClientAction.
 *
 *   const action = usePortalAction("/api/sub-portal/schedule", !preview);
 *   <button disabled={!action.enabled || action.busy}
 *     onClick={() => action.run(`confirm:${p.id}`, { action: "confirm", phaseId: p.id },
 *       { success: "Thanks — Penney knows you'll be there.", onSuccess: reload })}>
 *     {action.isBusy(`confirm:${p.id}`) ? "Saving…" : "Confirm"}
 *   </button>
 *   <PortalNotice notice={action.notice} onDismiss={action.clearNotice} />
 *
 * A response counts as success when the HTTP status is OK and the JSON has
 * no `error` (and isn't `ok: false` / `success: false`) — the shape every
 * sub-portal route already answers in (SubActionResponse).
 */

export interface PortalActionOptions<T> {
  /** Post somewhere other than the hook's endpoint for this one call. */
  endpoint?: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  /** The inline success line; a function can build it from the response. Nothing shown when omitted. */
  success?: string | ((data: T) => string | null);
  onSuccess?: (data: T) => void;
  onError?: (message: string) => void;
}

const PREVIEW_TEXT = "This is a preview. Nothing you tap here is saved.";
const OFFLINE_TEXT = "No connection. Check your signal and try again.";
const GENERIC_TEXT = "Could not save. Please try again.";
const SIGNED_OUT_TEXT = "You're signed out. Sign in again, then try once more.";

export function usePortalAction(endpoint: string, enabled: boolean) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<PortalNoticeValue | null>(null);
  // The state update lands a render later; the ref stops a second tap now.
  const inFlight = useRef(false);

  const run = useCallback(
    async <T extends object = Record<string, unknown>>(
      key: string,
      body: unknown,
      opts: PortalActionOptions<T> = {},
    ): Promise<T | null> => {
      if (!enabled) {
        setNotice({ tone: "info", text: PREVIEW_TEXT });
        return null;
      }
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusyKey(key);
      setNotice(null);
      try {
        const isForm = typeof FormData !== "undefined" && body instanceof FormData;
        const res = await fetch(opts.endpoint ?? endpoint, {
          method: opts.method ?? "POST",
          credentials: "same-origin",
          headers: isForm ? undefined : { "Content-Type": "application/json" },
          body: isForm ? (body as FormData) : JSON.stringify(body ?? {}),
        });
        let data: Record<string, unknown> = {};
        try {
          data = (await res.json()) as Record<string, unknown>;
        } catch {
          /* an empty or non-JSON body; the status decides */
        }
        const failed = !res.ok || data.ok === false || data.success === false || typeof data.error === "string";
        if (failed) {
          const message =
            typeof data.error === "string" && data.error.trim()
              ? data.error
              : res.status === 401
                ? SIGNED_OUT_TEXT
                : GENERIC_TEXT;
          setNotice({ tone: "error", text: message });
          opts.onError?.(message);
          return null;
        }
        const result = data as T;
        const text = typeof opts.success === "function" ? opts.success(result) : opts.success;
        if (text) setNotice({ tone: "success", text });
        opts.onSuccess?.(result);
        return result;
      } catch {
        setNotice({ tone: "error", text: OFFLINE_TEXT });
        opts.onError?.(OFFLINE_TEXT);
        return null;
      } finally {
        inFlight.current = false;
        setBusyKey(null);
      }
    },
    [endpoint, enabled],
  );

  const isBusy = useCallback((key: string) => busyKey === key, [busyKey]);
  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    /** Save: run(key, body, options) → the parsed response, or null on failure / preview. */
    run,
    /** The key of the save in flight, or null. */
    busyKey,
    /** Any save in flight. */
    busy: busyKey !== null,
    isBusy,
    /** The inline message to render with <PortalNotice>. */
    notice,
    setNotice,
    clearNotice,
    /** False in the staff preview: disable every saving button. */
    enabled,
  };
}

export type PortalAction = ReturnType<typeof usePortalAction>;

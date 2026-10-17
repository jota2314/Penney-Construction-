/**
 * An inline message under the thing that was tapped, in place of alert():
 * a dialog box is easy to miss with gloves on and blocks the page. Solid,
 * readable, no animation.
 */

export type NoticeTone = "success" | "error" | "info";

export interface PortalNoticeValue {
  tone: NoticeTone;
  text: string;
}

const TONES: Record<NoticeTone, { bg: string; border: string; fg: string; mark: string }> = {
  success: { bg: "#EEF5F0", border: "#B9D6C4", fg: "#245A41", mark: "✓" },
  error: { bg: "#FBEDE7", border: "#E9B9A5", fg: "#8A2D10", mark: "!" },
  info: { bg: "#F1F0EC", border: "#E4E0D8", fg: "#3A4340", mark: "●" },
};

export function PortalNotice({
  notice,
  onDismiss,
  className = "",
}: {
  notice: PortalNoticeValue | null;
  /** Shows a 44px "OK" to clear it. */
  onDismiss?: () => void;
  className?: string;
}) {
  if (!notice) return null;
  const t = TONES[notice.tone];
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[15px] font-semibold ${className}`}
      style={{ background: t.bg, borderColor: t.border, color: t.fg }}
    >
      <span aria-hidden className="mt-px shrink-0 font-extrabold">{t.mark}</span>
      <p className="min-w-0 flex-1">{notice.text}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="-my-2 -mr-1.5 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center px-2 font-bold underline">
          OK
        </button>
      )}
    </div>
  );
}

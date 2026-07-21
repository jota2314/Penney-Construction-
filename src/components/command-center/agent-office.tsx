"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Loader2, X } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { AgentDef } from "@/lib/agents/registry";
import type { AgentRun, AgentStatus } from "@/lib/actions/agents";

/** Walkable floor area, in % of the office box. Top rows are reserved for
 *  the whiteboard / window furniture, so wandering starts a bit down. */
const FLOOR = { x0: 9, x1: 89, y0: 36, y1: 82 };

const ACCENT_DOT: Record<string, string> = {
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
};

const ACCENT_RING: Record<string, string> = {
  amber: "ring-amber-500/40",
  emerald: "ring-emerald-500/40",
  sky: "ring-sky-500/40",
  violet: "ring-violet-500/40",
};

interface Pose {
  x: number;
  y: number;
  dur: number;
  face: 1 | -1;
}

function isWorking(status?: AgentStatus): boolean {
  return status?.last_status === "running";
}

function rnd(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function stateLabel(agent: AgentDef, status?: AgentStatus): string {
  if (!agent.live) return "Not clocked in";
  if (isWorking(status)) return "On the job…";
  if (status?.last_status === "success") return "Shift done";
  if (status?.last_status === "error") return "Needs help";
  return "Clocked in";
}

export function AgentOffice({
  agents,
  statuses,
  runs = [],
  pendingCounts = {},
}: {
  agents: AgentDef[];
  statuses: AgentStatus[];
  /** Recent shifts, newest first — the selected worker's card shows their last few. */
  runs?: AgentRun[];
  /** Pending review-queue count per agent_key. */
  pendingCounts?: Record<string, number>;
}) {
  const statusFor = useCallback(
    (key: string) => statuses.find((s) => s.agent_key === key),
    [statuses],
  );

  const [selected, setSelected] = useState<string | null>(null);

  const [poses, setPoses] = useState<Record<string, Pose>>(() => {
    const p: Record<string, Pose> = {};
    let liveI = 0;
    let deadI = 0;
    for (const a of agents) {
      if (a.live) {
        const gx = FLOOR.x0 + 16 + (liveI % 3) * 26;
        const gy = FLOOR.y0 + 8 + Math.floor(liveI / 3) * 20;
        p[a.key] = { x: gx, y: gy, dur: 1200, face: 1 };
        liveI++;
      } else {
        // Coming-soon agents queue up by the front door (bottom-center).
        p[a.key] = { x: 33 + deadI * 8, y: 90, dur: 1200, face: 1 };
        deadI++;
      }
    }
    return p;
  });

  // Keep the latest status lookup in a ref so the wander loop doesn't reset
  // its timer every time the parent re-polls.
  const statusRef = useRef(statusFor);
  statusRef.current = statusFor;

  useEffect(() => {
    const tick = () => {
      setPoses((prev) => {
        const next: Record<string, Pose> = { ...prev };
        for (const a of agents) {
          const cur = prev[a.key];
          if (!cur || !a.live) continue; // "coming soon" workers stand still
          const tx = rnd(FLOOR.x0, FLOOR.x1);
          const ty = rnd(FLOOR.y0, FLOOR.y1);
          const dist = Math.hypot(tx - cur.x, ty - cur.y);
          const working = isWorking(statusRef.current(a.key));
          const speed = working ? 15 : 7; // % of floor per second
          const dur = Math.min(Math.max((dist / speed) * 1000, 900), 2400);
          const face: 1 | -1 =
            tx < cur.x - 0.5 ? -1 : tx > cur.x + 0.5 ? 1 : cur.face;
          next[a.key] = { x: tx, y: ty, dur, face };
        }
        return next;
      });
    };
    tick(); // start moving right away
    const id = setInterval(tick, 2600);
    return () => clearInterval(id);
  }, [agents]);

  const selectedAgent = selected
    ? agents.find((a) => a.key === selected)
    : undefined;

  return (
    <div>
      <style>{`
        @keyframes pc-walk { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes pc-amble { 0%,100%{transform:translateY(0) rotate(-1.5deg)} 50%{transform:translateY(-2px) rotate(1.5deg)} }
        @keyframes pc-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        @media (prefers-reduced-motion: reduce){
          .pc-anim{animation:none !important}
        }
      `}</style>

      <div
        className="relative h-[460px] w-full overflow-hidden rounded-2xl border border-border/60 shadow-inner sm:h-[520px]"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, #3a3022 0%, #2a2419 45%, #211c14 100%)",
        }}
        onClick={() => setSelected(null)}
      >
        {/* Polished marble floor */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 top-[24%]"
          style={{
            backgroundColor: "#161410",
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 1px, transparent 1px 88px), repeating-linear-gradient(90deg, rgba(255,255,255,.04) 0 1px, transparent 1px 88px), radial-gradient(55% 45% at 28% 18%, rgba(255,255,255,.06), transparent 60%), radial-gradient(50% 40% at 82% 72%, rgba(214,158,46,.06), transparent 60%), linear-gradient(180deg, rgba(255,255,255,.02), rgba(0,0,0,.32))",
          }}
        />
        {/* Marble veining */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 top-[24%] opacity-50"
          style={{
            backgroundImage:
              "repeating-linear-gradient(123deg, rgba(214,158,46,.05) 0 1px, transparent 1px 70px), repeating-linear-gradient(57deg, rgba(255,255,255,.03) 0 1px, transparent 1px 110px)",
          }}
        />
        {/* Glossy reflection of the wall onto the marble */}
        <div
          className="pointer-events-none absolute inset-x-0 top-[24%] h-[18%]"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,.03) 40%, transparent 100%)",
          }}
        />

        {/* Back wall */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[24%]"
          style={{
            background: "linear-gradient(180deg,#27241d 0%,#1a1712 100%)",
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 70px)",
          }}
        />
        {/* Metallic baseboard at the wall/floor seam */}
        <div
          className="pointer-events-none absolute inset-x-0"
          style={{
            top: "24%",
            height: 6,
            transform: "translateY(-100%)",
            background: "linear-gradient(180deg,#6b6660,#2c2925)",
            boxShadow: "0 2px 6px rgba(0,0,0,.4)",
          }}
        />

        {/* Backlit logo */}
        <div className="pointer-events-none absolute left-1/2 top-[5%] -translate-x-1/2 text-center">
          <div
            className="text-[13px] font-bold uppercase tracking-[0.32em] text-amber-300"
            style={{ textShadow: "0 0 14px rgba(245,158,11,.85)" }}
          >
            Penney Construction
          </div>
          <div
            className="mx-auto mt-1 h-px w-28"
            style={{
              background:
                "linear-gradient(90deg,transparent,rgba(245,158,11,.7),transparent)",
            }}
          />
        </div>

        {/* Framed blueprint */}
        <div
          className="pointer-events-none absolute left-[6%] top-[6%] h-[12%] w-[15%] rounded-sm border border-zinc-600 shadow"
          style={{
            backgroundColor: "#16365f",
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,.22) 0 1px, transparent 1px 8px), repeating-linear-gradient(90deg, rgba(255,255,255,.22) 0 1px, transparent 1px 8px), linear-gradient(135deg, rgba(255,255,255,.18), transparent 40%)",
          }}
        />
        {/* Window with a sunset job-site view */}
        <div
          className="pointer-events-none absolute right-[6%] top-[5%] h-[13%] w-[20%] overflow-hidden rounded-sm border-2 border-zinc-700 shadow-inner"
          style={{
            background:
              "linear-gradient(180deg,#1e3a5f 0%,#3b5e84 38%,#c98a4b 76%,#e6ad6c 100%)",
          }}
        >
          <div className="absolute right-[22%] top-[42%] h-3 w-3 rounded-full bg-amber-100/90 blur-[1px]" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-700/80" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-zinc-700/80" />
        </div>

        {/* Soft ceiling light pools on the marble */}
        <LightPool x={20} y={50} />
        <LightPool x={50} y={62} />
        <LightPool x={80} y={48} />

        {/* Center rug */}
        <div
          className="pointer-events-none absolute left-1/2 top-[74%] h-[22%] w-[36%] -translate-x-1/2 -translate-y-1/2 rounded-[16px]"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(214,158,46,.16), rgba(214,158,46,.05) 68%, transparent)",
            border: "1px solid rgba(214,158,46,.22)",
          }}
        />

        {/* Workstations */}
        <Desk x={20} y={52} accent="sky" />
        <Desk x={50} y={64} accent="emerald" />
        <Desk x={80} y={50} accent="amber" />

        {/* Coffee bar */}
        <div className="pointer-events-none absolute left-[7%] top-[66%] -translate-y-1/2">
          <div
            className="h-[26px] w-[42px] rounded-[6px]"
            style={{
              background: "linear-gradient(180deg,#3a352f,#262220)",
              border: "1px solid rgba(0,0,0,.45)",
              boxShadow: "0 6px 12px rgba(0,0,0,.4)",
            }}
          />
          <div className="absolute left-1/2 top-[3px] -translate-x-1/2 text-sm">
            ☕
          </div>
        </div>

        {/* Plants */}
        <Plant x={5} y={44} />
        <Plant x={95} y={80} />

        {/* Glass front doors */}
        <div className="pointer-events-none absolute bottom-[2px] left-1/2 -translate-x-1/2">
          <div className="flex gap-[2px]">
            <div
              className="h-[30px] w-[16px] rounded-t-[3px] border border-zinc-500/60"
              style={{
                background:
                  "linear-gradient(180deg, rgba(180,210,230,.38), rgba(120,150,170,.22))",
              }}
            />
            <div
              className="h-[30px] w-[16px] rounded-t-[3px] border border-zinc-500/60"
              style={{
                background:
                  "linear-gradient(180deg, rgba(180,210,230,.38), rgba(120,150,170,.22))",
              }}
            />
          </div>
        </div>

        {/* Mood vignette (sits under the characters) */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 100% at 50% 35%, transparent 55%, rgba(0,0,0,.45) 100%)",
          }}
        />

        {/* Characters */}
        {agents.map((agent) => {
          const pose = poses[agent.key];
          if (!pose) return null;
          const status = statusFor(agent.key);
          const working = isWorking(status);
          const dim = !agent.live;
          const anim = dim ? "" : "pc-anim";
          const animName = dim ? "none" : working ? "pc-walk" : "pc-amble";
          const animDur = working ? "0.5s" : "2.4s";

          return (
            <button
              key={agent.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelected(agent.key);
              }}
              className="group absolute flex -translate-x-1/2 -translate-y-full flex-col items-center focus:outline-none"
              style={{
                left: `${pose.x}%`,
                top: `${pose.y}%`,
                transition: `left ${pose.dur}ms linear, top ${pose.dur}ms linear`,
                zIndex: Math.round(pose.y),
              }}
              aria-label={`${agent.name} — ${stateLabel(agent, status)}`}
            >
              {/* Working bubble */}
              {working && (
                <div
                  className="pc-anim mb-0.5 whitespace-nowrap rounded-full border border-emerald-400/50 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-200 shadow"
                  style={{ animation: "pc-float 1.4s ease-in-out infinite" }}
                >
                  💬 working…
                </div>
              )}

              <div className="relative flex h-[56px] w-[60px] items-end justify-center">
                {/* Shadow */}
                <div className="absolute bottom-0 h-[9px] w-[34px] rounded-[50%] bg-black/35 blur-[1px]" />
                {/* Sprite (face flip outside, bob inside) */}
                <span
                  className="relative block leading-none"
                  style={{ transform: `scaleX(${pose.face})` }}
                >
                  <span
                    className={`block text-[40px] leading-none ${anim} ${
                      dim ? "opacity-50 grayscale" : ""
                    }`}
                    style={{
                      animation:
                        animName === "none"
                          ? "none"
                          : `${animName} ${animDur} ease-in-out infinite`,
                    }}
                  >
                    👷
                  </span>
                </span>
                {/* Tool badge */}
                <span
                  className={`absolute right-[10px] top-0 grid h-[20px] w-[20px] place-items-center rounded-full bg-background text-[11px] shadow ring-2 ${
                    dim ? "opacity-50 grayscale ring-border" : ACCENT_RING[agent.color] ?? "ring-amber-500/40"
                  }`}
                >
                  {agent.emoji}
                </span>
              </div>

              {/* Name tag */}
              <div
                className={`-mt-1 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm transition group-hover:scale-105 ${
                  dim
                    ? "border-border/50 bg-background/70 text-muted-foreground"
                    : "border-border bg-background/90 text-foreground"
                }`}
              >
                {!dim && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      working
                        ? "animate-pulse bg-emerald-500"
                        : status?.last_status === "error"
                          ? "bg-rose-500"
                          : ACCENT_DOT[agent.color] ?? "bg-amber-500"
                    }`}
                  />
                )}
                {agent.name}
              </div>
            </button>
          );
        })}

        {/* Selected agent detail card */}
        {selectedAgent && (
          <div
            className="absolute bottom-3 left-1/2 z-[999] w-[min(92%,420px)] -translate-x-1/2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
              <div className="flex items-start gap-3">
                <div className="text-3xl leading-none" aria-hidden>
                  👷
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{selectedAgent.emoji}</span>
                    <h3 className="truncate font-semibold text-foreground">
                      {selectedAgent.name}
                    </h3>
                    {!selectedAgent.live && (
                      <Badge variant="outline" className="text-[10px]">
                        Coming soon
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedAgent.role} ·{" "}
                    {stateLabel(selectedAgent, statusFor(selectedAgent.key))}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">
                {selectedAgent.description}
              </p>

              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {selectedAgent.schedule}
                </span>
                {selectedAgent.live && (
                  <span className="font-medium text-foreground">
                    {statusFor(selectedAgent.key)?.lifetime_items ?? 0} done
                  </span>
                )}
              </div>

              {selectedAgent.live &&
                (pendingCounts[selectedAgent.key] ?? 0) > 0 && (
                  <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-500">
                    {pendingCounts[selectedAgent.key]} item
                    {pendingCounts[selectedAgent.key] === 1 ? "" : "s"} waiting
                    on your review below
                  </p>
                )}

              {selectedAgent.live &&
                (() => {
                  const shifts = runs
                    .filter((r) => r.agent_key === selectedAgent.key)
                    .slice(0, 3);
                  if (shifts.length === 0) return null;
                  return (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Recent shifts
                      </p>
                      {shifts.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-start gap-1.5 text-[11px]"
                        >
                          {r.status === "running" ? (
                            <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-emerald-500" />
                          ) : r.status === "success" ? (
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                          ) : (
                            <X className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-foreground">
                              {r.summary || "Ran"}
                            </span>
                            <span className="block text-muted-foreground">
                              {formatDate(r.started_at)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
            </div>
          </div>
        )}
      </div>

      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Tap a worker to see what they do · clocked-in agents roam the floor, busy
        ones show a 💬
      </p>
    </div>
  );
}

const SCREEN: Record<string, { from: string; to: string; glow: string }> = {
  sky: { from: "#7dd3fc", to: "#0284c7", glow: "rgba(56,189,248,.55)" },
  emerald: { from: "#6ee7b7", to: "#059669", glow: "rgba(16,185,129,.55)" },
  amber: { from: "#fcd34d", to: "#d97706", glow: "rgba(245,158,11,.55)" },
  violet: { from: "#c4b5fd", to: "#7c3aed", glow: "rgba(139,92,246,.55)" },
};

/** A top-down computer workstation: chair, desk, glowing monitor, keyboard. */
function Desk({ x, y, accent }: { x: number; y: number; accent: string }) {
  const s = SCREEN[accent] ?? SCREEN.amber;
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: Math.round(y) - 2 }}
    >
      <div className="relative" style={{ width: 104, height: 88 }}>
        {/* Office chair (top-down: seat + backrest behind it) */}
        <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center gap-[2px]">
          <div
            className="h-[20px] w-[30px] rounded-[8px]"
            style={{
              background: "linear-gradient(180deg,#3c3c44,#222228)",
              border: "1px solid rgba(0,0,0,.45)",
              boxShadow: "0 3px 6px rgba(0,0,0,.4)",
            }}
          />
          <div
            className="h-[7px] w-[34px] rounded-[5px]"
            style={{
              background: "linear-gradient(180deg,#47474f,#2c2c33)",
              border: "1px solid rgba(0,0,0,.4)",
            }}
          />
        </div>

        {/* Desk surface */}
        <div
          className="absolute left-1/2 top-[6px] -translate-x-1/2 rounded-[8px]"
          style={{
            width: 96,
            height: 48,
            background:
              "linear-gradient(160deg,#4c4842 0%,#332f2a 60%,#262320 100%)",
            border: "1px solid rgba(0,0,0,.45)",
            boxShadow:
              "0 9px 18px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08)",
          }}
        >
          <div
            className="absolute inset-x-0 bottom-0 h-[4px] rounded-b-[8px]"
            style={{ background: "linear-gradient(180deg,#6d6d75,#3a3a40)" }}
          />
        </div>

        {/* Monitor with glowing screen */}
        <div
          className="absolute left-1/2 top-[10px] -translate-x-1/2 rounded-[3px] p-[2px]"
          style={{
            width: 56,
            background: "#0b0b0e",
            border: "1px solid rgba(255,255,255,.08)",
            boxShadow: `0 0 16px ${s.glow}`,
          }}
        >
          <div
            className="relative h-[21px] w-full overflow-hidden rounded-[2px]"
            style={{ background: `linear-gradient(160deg, ${s.from}, ${s.to})` }}
          >
            <div className="absolute left-[4px] top-[4px] h-[2px] w-[62%] rounded bg-white/75" />
            <div className="absolute left-[4px] top-[9px] h-[2px] w-[42%] rounded bg-white/55" />
            <div className="absolute left-[4px] top-[14px] h-[2px] w-[54%] rounded bg-white/45" />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, rgba(255,255,255,.28), transparent 55%)",
              }}
            />
          </div>
        </div>

        {/* Keyboard */}
        <div
          className="absolute left-1/2 top-[35px] -translate-x-1/2 h-[9px] w-[34px] rounded-[2px]"
          style={{
            background: "linear-gradient(180deg,#e6e6eb,#b9b9c0)",
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(0,0,0,.18) 0 1px, transparent 1px 4px)",
            border: "1px solid rgba(0,0,0,.3)",
          }}
        />
        {/* Mouse */}
        <div
          className="absolute left-1/2 top-[35px] ml-[22px] h-[8px] w-[6px] rounded-[3px]"
          style={{ background: "#d6d6dc", border: "1px solid rgba(0,0,0,.3)" }}
        />
        {/* Coffee mug */}
        <div
          className="absolute left-1/2 top-[34px] -ml-[30px] h-[8px] w-[8px] rounded-full"
          style={{
            background: "radial-gradient(circle at 35% 30%, #f5c97a, #b9772b)",
            border: "1px solid rgba(0,0,0,.3)",
          }}
        />
      </div>
    </div>
  );
}

/** Potted plant. */
function Plant({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: Math.round(y) - 1 }}
    >
      <div className="flex flex-col items-center">
        <div className="text-2xl leading-none">🌿</div>
        <div
          className="-mt-1 h-[14px] w-[16px] rounded-b-[6px] rounded-t-[2px]"
          style={{
            background: "linear-gradient(180deg,#caa46a,#8a6a3a)",
            border: "1px solid rgba(0,0,0,.3)",
          }}
        />
      </div>
    </div>
  );
}

/** Soft pool of light cast on the floor from a ceiling fixture. */
function LightPool({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: 180,
        height: 130,
        background:
          "radial-gradient(closest-side, rgba(255,248,230,.12), transparent)",
      }}
    />
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Clock, X } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { AgentDef } from "@/lib/agents/registry";
import type { AgentStatus } from "@/lib/actions/agents";

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
}: {
  agents: AgentDef[];
  statuses: AgentStatus[];
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
        {/* Floor tiles */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 top-[26%]"
          style={{
            backgroundColor: "#b98a4e",
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,.12) 0 1px, transparent 1px 44px), repeating-linear-gradient(90deg, rgba(0,0,0,.12) 0 1px, transparent 1px 44px), linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.25))",
          }}
        />
        {/* Back wall */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[26%]"
          style={{
            backgroundColor: "#4a4031",
            backgroundImage:
              "linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.2))",
          }}
        />

        {/* Office sign */}
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-center">
          <div className="rounded-md border border-amber-500/40 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-300/90">
            🏗️ Penney Construction · Office
          </div>
        </div>

        {/* Wall decor */}
        <div className="pointer-events-none absolute left-[6%] top-[10%] flex h-[12%] w-[20%] items-center justify-center rounded border border-white/20 bg-white/85 text-[10px] font-semibold text-zinc-700 shadow">
          📋 Job Board
        </div>
        <div className="pointer-events-none absolute right-[7%] top-[9%] h-[13%] w-[16%] rounded border border-sky-300/40 bg-gradient-to-b from-sky-300/70 to-sky-500/40 shadow" />
        <div className="pointer-events-none absolute left-1/2 top-[8%] -translate-x-1/2 text-2xl">
          🕐
        </div>

        {/* Furniture (top-down) */}
        {/* Desks */}
        <Furniture x={16} y={50} label="🖥️" w={70} />
        <Furniture x={50} y={64} label="🖥️" w={70} />
        <Furniture x={82} y={48} label="🖥️" w={70} />
        {/* Plants + coffee + door */}
        <div className="pointer-events-none absolute left-[5%] top-[40%] text-3xl">
          🪴
        </div>
        <div className="pointer-events-none absolute right-[4%] top-[78%] text-3xl">
          🪴
        </div>
        <div className="pointer-events-none absolute left-[7%] top-[76%] text-2xl">
          ☕
        </div>
        {/* Front door */}
        <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 text-3xl">
          🚪
        </div>

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
                statusFor(selectedAgent.key)?.last_run_at && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Last shift{" "}
                    {formatDate(statusFor(selectedAgent.key)!.last_run_at!)}
                  </p>
                )}
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

function Furniture({
  x,
  y,
  label,
  w,
}: {
  x: number;
  y: number;
  label: string;
  w: number;
}) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: Math.round(y) - 1 }}
    >
      <div
        className="flex items-center justify-center rounded-md border border-black/30 bg-gradient-to-b from-[#7c5a36] to-[#5e4225] text-lg shadow-md"
        style={{ width: w, height: w * 0.46 }}
      >
        {label}
      </div>
    </div>
  );
}

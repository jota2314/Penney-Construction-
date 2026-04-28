"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  MapPin,
  Phone,
  Camera,
  AlertTriangle,
  Check,
  X,
  HardHat,
  ChevronRight,
  Navigation,
} from "lucide-react";
import { clockIn, clockOut } from "@/lib/actions/time-entries";

// ---------------------------------------------------------------------------
// Types from server
// ---------------------------------------------------------------------------

export type CrewProject = {
  id: string;
  name: string;
  project_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
};

export type ActiveEntry = {
  id: string;
  project_id: string;
  clock_in: string;
  projects?: { name: string; project_number: string } | null;
};

// ---------------------------------------------------------------------------
// Design tokens — match Command Center
// ---------------------------------------------------------------------------

const TOKENS: CSSProperties = {
  // @ts-expect-error CSS custom properties
  "--pcc-bg":        "#0E0D0B",
  "--pcc-bg-2":      "#1A1814",
  "--pcc-card":      "#16140F",
  "--pcc-ink":       "#F5F1EA",
  "--pcc-muted":     "#A8A29E",
  "--pcc-quiet":     "#6B655F",
  "--pcc-line":      "rgba(255,255,255,0.08)",
  "--pcc-line-soft": "rgba(255,255,255,0.04)",
  "--pcc-accent":    "#D97706",
};
const v = (k: string) => `var(--pcc-${k})`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

async function getLocation(): Promise<{ lat?: number; lng?: number }> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return {};
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
    );
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return {};
  }
}

function shortAddress(p: CrewProject) {
  return p.address ?? "Address pending";
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

function Greeting({ firstName }: { firstName: string | null }) {
  const { tod, today } = useMemo(() => {
    const d = new Date();
    const hr = d.getHours();
    const t = hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : "Evening";
    return { tod: t, today: d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) };
  }, []);
  return (
    <div className="px-4 pt-5">
      <div className="text-[12px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>{today}</div>
      <div className="text-[28px] sm:text-[32px] font-semibold tracking-tight mt-1.5 leading-tight" style={{ color: v("ink") }}>
        {tod}, <span style={{ color: v("accent") }}>{firstName ?? "there"}</span>.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today card (clocked-in vs not)
// ---------------------------------------------------------------------------

function ActiveTimer({ clockInTime, projectName, onClockOut, busy }: {
  clockInTime: string;
  projectName: string;
  onClockOut: () => void;
  busy: boolean;
}) {
  const [elapsed, setElapsed] = useState("00:00:00");
  useEffect(() => {
    const start = new Date(clockInTime).getTime();
    const tick = () => setElapsed(formatElapsed(Date.now() - start));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [clockInTime]);

  return (
    <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: v("card"), border: `1.5px solid rgba(217, 119, 6, 0.4)` }}>
      <div className="absolute -right-12 -top-12 w-40 h-40 rounded-full" style={{ background: "radial-gradient(circle, rgba(217,119,6,0.18), transparent 70%)" }} />
      <div className="relative">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase" style={{ color: "#34d399", letterSpacing: "0.18em" }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
          On the clock
        </div>
        <div className="mt-2 text-[44px] sm:text-[52px] font-semibold tracking-tight font-mono" style={{ color: v("ink"), fontVariantNumeric: "tabular-nums" }}>
          {elapsed}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[14px]" style={{ color: v("muted") }}>
          <MapPin className="h-3.5 w-3.5" />
          {projectName}
        </div>
        <button
          onClick={onClockOut}
          disabled={busy}
          className="mt-5 w-full py-4 rounded-xl flex items-center justify-center gap-2 text-[16px] font-semibold transition active:scale-[0.98] disabled:opacity-60"
          style={{ background: "#dc2626", color: "white" }}
        >
          <Clock className="h-5 w-5" />
          {busy ? "Clocking out…" : "Clock out"}
        </button>
      </div>
    </div>
  );
}

function TodayJobCard({ project, onClockIn, busy }: {
  project: CrewProject;
  onClockIn: () => void;
  busy: boolean;
}) {
  const directionsHref = useMemo(() => {
    const q = [project.address, project.city, project.state].filter(Boolean).join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }, [project.address, project.city, project.state]);

  return (
    <div className="rounded-2xl p-5" style={{ background: v("card"), border: `1.5px solid ${v("line")}` }}>
      <div className="text-[12px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>
        Today&apos;s job
      </div>
      <div className="mt-3 text-[44px] sm:text-[52px] font-semibold leading-[1.02] tracking-tight" style={{ color: v("ink") }}>
        {project.address ?? project.name}
        {(project.city || project.state) && (
          <div className="text-[26px] sm:text-[30px] font-medium tracking-tight" style={{ color: v("muted") }}>
            {[project.city, project.state].filter(Boolean).join(", ")}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 text-[13px]" style={{ color: v("muted") }}>
        <span className="font-mono uppercase tracking-wider">{project.project_number}</span>
        <span style={{ color: v("quiet") }}>·</span>
        <span className="capitalize">{project.status.replace(/_/g, " ")}</span>
      </div>

      <button
        onClick={onClockIn}
        disabled={busy}
        className="mt-5 w-full py-4 rounded-xl flex items-center justify-center gap-2 text-[16px] font-semibold transition active:scale-[0.98] disabled:opacity-60"
        style={{ background: v("accent"), color: "#1a0f00" }}
      >
        <Clock className="h-5 w-5" />
        {busy ? "Clocking in…" : "Clock in"}
      </button>

      <a
        href={directionsHref}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 w-full py-3 rounded-xl flex items-center justify-center gap-2 text-[14px] font-medium transition active:scale-[0.98]"
        style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
      >
        <Navigation className="h-4 w-4" />
        Get directions
      </a>
    </div>
  );
}

function NoAssignedJob() {
  return (
    <div className="rounded-2xl p-6 flex flex-col items-center text-center" style={{ background: v("bg-2"), border: `1px solid ${v("line-soft")}` }}>
      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(217, 119, 6, 0.14)", color: v("accent") }}>
        <HardHat className="h-6 w-6" />
      </div>
      <div className="text-[16px] font-semibold mb-1" style={{ color: v("ink") }}>
        No site assigned today
      </div>
      <div className="text-[13px] max-w-[280px]" style={{ color: v("muted") }}>
        Talk to your lead — your supervisor will assign you a project.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick actions row
// ---------------------------------------------------------------------------

function QuickAction({ icon: Icon, label, onClick, href }: {
  icon: typeof Camera;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <div className="flex flex-col items-center gap-1.5 py-3 rounded-xl active:scale-95 transition w-full" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <span className="h-9 w-9 grid place-items-center rounded-lg" style={{ background: "rgba(217,119,6,0.14)", color: v("accent") }}>
        <Icon className="h-4.5 w-4.5" strokeWidth={1.7} />
      </span>
      <span className="text-[11px] font-medium" style={{ color: v("ink") }}>{label}</span>
    </div>
  );
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className="flex-1">{inner}</a>;
  }
  return <button onClick={onClick} className="flex-1">{inner}</button>;
}

// ---------------------------------------------------------------------------
// Daily log composer
// ---------------------------------------------------------------------------

type LogEntry = { id: string; text: string; time: string };

function DailyLogComposer() {
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [focused, setFocused] = useState(false);

  const today = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    []
  );

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const time = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    setEntries((prev) => [...prev, { id: crypto.randomUUID(), text, time }]);
    setDraft("");
    setFocused(false);
  };

  return (
    <div className="rounded-2xl p-4" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
          Daily log · {today}
        </div>
        {entries.length > 0 && (
          <div className="text-[11px] font-mono" style={{ color: v("muted") }}>
            {entries.length} {entries.length === 1 ? "note" : "notes"}
          </div>
        )}
      </div>
      <div className="text-[16px] font-semibold leading-tight tracking-tight mb-3" style={{ color: v("ink") }}>
        What did you work on today?
      </div>

      {entries.length > 0 && (
        <ul className="flex flex-col gap-2 mb-3">
          {entries.map((entry, i) => (
            <li
              key={entry.id}
              className="flex items-start gap-3 pt-2"
              style={{ borderTop: i === 0 ? "none" : `1px solid ${v("line-soft")}` }}
            >
              <span className="font-mono text-[11px] mt-1 w-[42px] flex-shrink-0" style={{ color: v("quiet") }}>{entry.time}</span>
              <div className="flex-1 text-[14px] leading-snug whitespace-pre-wrap" style={{ color: v("ink") }}>{entry.text}</div>
              <button
                onClick={() => setEntries((prev) => prev.filter((e) => e.id !== entry.id))}
                aria-label="Remove note"
                className="opacity-40 hover:opacity-100 transition flex-shrink-0 mt-0.5"
                style={{ color: v("muted") }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder="What you worked on, hours, anything stuck…"
        rows={focused || draft ? 3 : 2}
        className="w-full resize-none rounded-xl px-3 py-2.5 text-[14px] leading-snug transition outline-none"
        style={{
          background: v("bg-2"),
          color: v("ink"),
          border: `1px solid ${focused ? v("accent") : v("line")}`,
          fontFamily: "inherit",
        }}
      />

      <div className="flex items-center justify-between gap-2 mt-2.5">
        <div className="text-[11px]" style={{ color: v("quiet") }}>
          {draft.length === 0 ? "Even small wins count." : `${draft.length} chars`}
        </div>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="px-3.5 py-2 rounded-lg flex items-center gap-1.5 text-[13px] font-semibold transition active:scale-[0.98] disabled:opacity-40"
          style={{ background: v("accent"), color: "#1a0f00" }}
        >
          <Check className="h-4 w-4" />
          Save log
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Other assigned projects
// ---------------------------------------------------------------------------

function OtherProjectsList({ projects }: { projects: CrewProject[] }) {
  if (projects.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-medium uppercase px-1" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
        Other assigned · {projects.length}
      </div>
      {projects.map((p) => {
        const directionsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.address, p.city, p.state].filter(Boolean).join(", "))}`;
        return (
          <a
            key={p.id}
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl p-4 flex items-center gap-3 transition active:scale-[0.99]"
            style={{ background: v("card"), border: `1px solid ${v("line")}` }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold leading-tight truncate" style={{ color: v("ink") }}>{p.name}</div>
              <div className="text-[12px] font-mono uppercase mt-0.5" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
                {p.project_number} · <span className="capitalize">{p.status.replace(/_/g, " ")}</span>
              </div>
              <div className="flex items-center gap-1 text-[12px] mt-1.5 truncate" style={{ color: v("muted") }}>
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {shortAddress(p)}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 flex-shrink-0" style={{ color: v("quiet") }} />
          </a>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CrewFieldFeed({
  firstName,
  employeeId,
  projects,
  activeEntry,
}: {
  firstName: string | null;
  employeeId: string;
  projects: CrewProject[];
  activeEntry: ActiveEntry | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Pick today's primary project: active entry > first in_progress > first assigned
  const todayProject: CrewProject | null = useMemo(() => {
    if (activeEntry) {
      return projects.find((p) => p.id === activeEntry.project_id) ?? null;
    }
    return projects.find((p) => p.status === "in_progress") ?? projects[0] ?? null;
  }, [projects, activeEntry]);

  const otherProjects = useMemo(
    () => projects.filter((p) => p.id !== todayProject?.id),
    [projects, todayProject]
  );

  // Throttle to ignore rapid double-clicks
  const lastClickRef = useRef(0);
  const guard = () => {
    const now = Date.now();
    if (now - lastClickRef.current < 600) return false;
    lastClickRef.current = now;
    return true;
  };

  const handleClockIn = async () => {
    if (!todayProject || !guard()) return;
    setBusy(true);
    try {
      const { lat, lng } = await getLocation();
      const result = await clockIn(employeeId, todayProject.id, lat, lng);
      if (result.error) alert(result.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleClockOut = async () => {
    if (!activeEntry || !guard()) return;
    setBusy(true);
    try {
      const { lat, lng } = await getLocation();
      await clockOut(activeEntry.id, lat, lng);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full" style={{ ...TOKENS, background: v("bg"), color: v("ink"), fontFamily: "var(--font-geist-sans), -apple-system, sans-serif" }}>
      <div className="max-w-[460px] mx-auto pb-8">
        <Greeting firstName={firstName} />

        <div className="px-4 mt-4 flex flex-col gap-4">
          {!todayProject ? (
            <NoAssignedJob />
          ) : activeEntry ? (
            <ActiveTimer
              clockInTime={activeEntry.clock_in}
              projectName={activeEntry.projects?.name ?? todayProject.name}
              onClockOut={handleClockOut}
              busy={busy}
            />
          ) : (
            <TodayJobCard project={todayProject} onClockIn={handleClockIn} busy={busy} />
          )}

          {todayProject && (
            <div className="grid grid-cols-4 gap-2">
              <QuickAction
                icon={Phone}
                label="Call lead"
                onClick={() => alert("Lead's number isn't wired yet. Coming next.")}
              />
              <QuickAction
                icon={Camera}
                label="Photo"
                href={`/crew/project/${todayProject.id}`}
              />
              <QuickAction
                icon={AlertTriangle}
                label="Need help"
                onClick={() => alert("Help request isn't wired yet. Coming next.")}
              />
              <QuickAction
                icon={Navigation}
                label="Map"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([todayProject.address, todayProject.city, todayProject.state].filter(Boolean).join(", "))}`}
              />
            </div>
          )}

          <DailyLogComposer />

          <OtherProjectsList projects={otherProjects} />
        </div>
      </div>
    </div>
  );
}

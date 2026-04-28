"use client";

import { useMemo, useRef, useState } from "react";
import {
  Search,
  Bell,
  Cloud,
  MapPin,
  Coffee,
  Car,
  CircleAlert,
  CheckCircle2,
  ListChecks,
  X,
  ChevronUp,
  Mic,
  Camera,
  Plus,
  Send,
  Image as ImageIcon,
  Hammer,
  Truck,
  ClipboardCheck,
  AlertTriangle,
  HandCoins,
  CalendarClock,
  FileSignature,
  MessageSquare,
  Sparkles,
  ChevronRight,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

type CrewStatus = "On Site" | "Driving" | "Break" | "Needs Help";

const CREW: {
  id: string;
  name: string;
  initials: string;
  trade: string;
  project: string;
  clockIn: string;
  status: CrewStatus;
  color: string;
}[] = [
  { id: "c1", name: "Mike R.", initials: "MR", trade: "Electrical", project: "Colten Remodel", clockIn: "7:42 AM", status: "On Site", color: "from-orange-500 to-amber-600" },
  { id: "c2", name: "Carlos V.", initials: "CV", trade: "Framing", project: "Iler Remodel", clockIn: "7:05 AM", status: "On Site", color: "from-emerald-500 to-emerald-700" },
  { id: "c3", name: "Tom B.", initials: "TB", trade: "Plumbing", project: "Danaher Bath", clockIn: "8:10 AM", status: "Needs Help", color: "from-rose-500 to-rose-700" },
  { id: "c4", name: "Howie C.", initials: "HC", trade: "Super", project: "Burns Kitchen", clockIn: "6:55 AM", status: "Driving", color: "from-sky-500 to-sky-700" },
  { id: "c5", name: "Luis P.", initials: "LP", trade: "Finish", project: "Gouthro Add.", clockIn: "7:30 AM", status: "Break", color: "from-violet-500 to-violet-700" },
  { id: "c6", name: "Andre K.", initials: "AK", trade: "Demo", project: "Pedersen Add.", clockIn: "7:18 AM", status: "On Site", color: "from-teal-500 to-teal-700" },
];

type StoryUrgency = "live" | "warn" | "alert" | "calm";

const STORIES: {
  id: string;
  project: string;
  initials: string;
  color: string;
  urgency: StoryUrgency;
  badge: number;
  updates: { id: string; image: string | null; note: string; postedBy: string; time: string }[];
}[] = [
  {
    id: "s1",
    project: "Colten Remodel",
    initials: "CR",
    color: "from-orange-500 to-rose-600",
    urgency: "live",
    badge: 4,
    updates: [
      { id: "u1", image: null, note: "Framing inspection passed — insulation crew booked Wed.", postedBy: "Mike R.", time: "8:32 AM" },
      { id: "u2", image: null, note: "New beam delivered, staged at front entry.", postedBy: "Carlos V.", time: "9:14 AM" },
      { id: "u3", image: null, note: "Client walked the site, loved the kitchen layout.", postedBy: "Jorge", time: "11:02 AM" },
    ],
  },
  { id: "s2", project: "Iler Remodel", initials: "IR", color: "from-emerald-500 to-teal-600", urgency: "warn", badge: 2, updates: [{ id: "u1", image: null, note: "Drywall crew running 1 day behind on second floor.", postedBy: "Howie C.", time: "10:11 AM" }] },
  { id: "s3", project: "Danaher Bath", initials: "DB", color: "from-rose-500 to-orange-500", urgency: "alert", badge: 1, updates: [{ id: "u1", image: null, note: "Tile selection mismatch — homeowner needs to confirm by EOD.", postedBy: "Tom B.", time: "8:55 AM" }] },
  { id: "s4", project: "Burns Kitchen", initials: "BK", color: "from-sky-500 to-indigo-600", urgency: "calm", badge: 3, updates: [{ id: "u1", image: null, note: "Cabinets delivered, all crates intact.", postedBy: "Howie C.", time: "9:40 AM" }] },
  { id: "s5", project: "Gouthro Add.", initials: "GA", color: "from-violet-500 to-fuchsia-600", urgency: "calm", badge: 1, updates: [{ id: "u1", image: null, note: "Final punch list 90% complete.", postedBy: "Luis P.", time: "11:48 AM" }] },
  { id: "s6", project: "Pedersen Add.", initials: "PA", color: "from-amber-500 to-orange-600", urgency: "warn", badge: 2, updates: [{ id: "u1", image: null, note: "Foundation pour rescheduled to Friday — weather.", postedBy: "Howie C.", time: "7:50 AM" }] },
];

type CardType =
  | "Inspection"
  | "Photo Update"
  | "Delivery"
  | "Sub Issue"
  | "Client Decision"
  | "Payment"
  | "Change Order Risk"
  | "Schedule Delay";

type Priority = "high" | "med" | "low";

const FIELD_CARDS: {
  id: string;
  type: CardType;
  title: string;
  project: string;
  time: string;
  postedBy: string;
  photos: number;
  priority: Priority;
  suggested: string;
}[] = [
  { id: "fc1", type: "Inspection", title: "Framing Inspection Passed", project: "Colten Remodel", time: "8:30 AM", postedBy: "Mike R.", photos: 3, priority: "med", suggested: "Notify client and schedule insulation." },
  { id: "fc2", type: "Client Decision", title: "Tile Color Approval Needed", project: "Danaher Bathroom", time: "9:12 AM", postedBy: "Tom B.", photos: 2, priority: "high", suggested: "Send 3 swatch photos to homeowner for sign-off." },
  { id: "fc3", type: "Delivery", title: "Cabinets Delivered", project: "Burns Kitchen", time: "9:45 AM", postedBy: "Howie C.", photos: 5, priority: "low", suggested: "Confirm install crew arrives Tuesday." },
  { id: "fc4", type: "Schedule Delay", title: "Foundation Pour Pushed to Friday", project: "Pedersen Addition", time: "7:50 AM", postedBy: "Howie C.", photos: 0, priority: "high", suggested: "Rebalance week — move framing crew to Iler." },
  { id: "fc5", type: "Payment", title: "Draw 3 Received — $42,500", project: "Iler Remodel", time: "11:02 AM", postedBy: "Nicole S.", photos: 0, priority: "med", suggested: "Mark milestone paid and update P&L." },
  { id: "fc6", type: "Sub Issue", title: "Plumber Short Crew Today", project: "Danaher Bathroom", time: "8:55 AM", postedBy: "Tom B.", photos: 0, priority: "high", suggested: "Call backup plumber or push rough-in." },
  { id: "fc7", type: "Change Order Risk", title: "Homeowner Wants Bigger Island", project: "Burns Kitchen", time: "10:20 AM", postedBy: "Jorge", photos: 1, priority: "med", suggested: "Draft change order — add ~$3,800 in cabinetry." },
  { id: "fc8", type: "Photo Update", title: "Roof Decking Complete", project: "Pedersen Addition", time: "11:40 AM", postedBy: "Andre K.", photos: 6, priority: "low", suggested: "Add to client weekly recap." },
];

const FEED_ITEMS: {
  id: string;
  time: string;
  project: string;
  type: string;
  summary: string;
  by: { initials: string; color: string };
  attachments: number;
  comments: number;
  tasks: number;
}[] = [
  { id: "f1", time: "11:48 AM", project: "Gouthro Add.", type: "Daily Log", summary: "Punch list 90% complete. Trim crew finishing baseboards in master.", by: { initials: "LP", color: "bg-violet-500" }, attachments: 2, comments: 1, tasks: 0 },
  { id: "f2", time: "11:40 AM", project: "Pedersen Add.", type: "Photo", summary: "Roof decking complete on north elevation.", by: { initials: "AK", color: "bg-teal-500" }, attachments: 6, comments: 0, tasks: 1 },
  { id: "f3", time: "11:02 AM", project: "Iler Remodel", type: "Payment", summary: "Draw 3 wired — $42,500 cleared.", by: { initials: "NS", color: "bg-amber-500" }, attachments: 1, comments: 0, tasks: 1 },
  { id: "f4", time: "10:20 AM", project: "Burns Kitchen", type: "Change Order", summary: "Homeowner asked about widening island by 12\".", by: { initials: "JB", color: "bg-orange-500" }, attachments: 1, comments: 2, tasks: 1 },
  { id: "f5", time: "9:45 AM", project: "Burns Kitchen", type: "Delivery", summary: "Cabinets delivered and staged in garage.", by: { initials: "HC", color: "bg-sky-500" }, attachments: 5, comments: 0, tasks: 0 },
  { id: "f6", time: "8:55 AM", project: "Danaher Bath", type: "Issue", summary: "Plumber short crew. Pushing rough-in to tomorrow.", by: { initials: "TB", color: "bg-rose-500" }, attachments: 0, comments: 3, tasks: 2 },
  { id: "f7", time: "8:30 AM", project: "Colten Remodel", type: "Inspection", summary: "Framing passed. Inspector signed off, ready for insulation.", by: { initials: "MR", color: "bg-orange-500" }, attachments: 3, comments: 1, tasks: 1 },
];

const PRIORITIES: { id: string; icon: typeof ClipboardCheck; label: string; tone: "amber" | "rose" | "sky" | "emerald" }[] = [
  { id: "p1", icon: ClipboardCheck, label: "3 inspections due today", tone: "amber" },
  { id: "p2", icon: AlertTriangle, label: "2 subs not clocked in", tone: "rose" },
  { id: "p3", icon: MessageSquare, label: "1 client decision blocking work", tone: "rose" },
  { id: "p4", icon: HandCoins, label: "2 invoices overdue", tone: "amber" },
  { id: "p5", icon: FileSignature, label: "1 change order needs approval", tone: "sky" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<CrewStatus, { dot: string; chip: string; icon: typeof MapPin }> = {
  "On Site": { dot: "bg-emerald-400", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: MapPin },
  Driving: { dot: "bg-sky-400", chip: "bg-sky-500/15 text-sky-300 border-sky-500/30", icon: Car },
  Break: { dot: "bg-amber-400", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: Coffee },
  "Needs Help": { dot: "bg-rose-400", chip: "bg-rose-500/15 text-rose-300 border-rose-500/30", icon: CircleAlert },
};

const URGENCY_RING: Record<StoryUrgency, string> = {
  live: "from-orange-400 via-amber-400 to-rose-500",
  warn: "from-amber-400 to-orange-500",
  alert: "from-rose-500 to-rose-700",
  calm: "from-zinc-600 to-zinc-700",
};

const CARD_TYPE_STYLE: Record<CardType, { icon: typeof Hammer; tint: string; label: string }> = {
  Inspection: { icon: ClipboardCheck, tint: "from-emerald-500/20 to-emerald-700/10 border-emerald-500/30", label: "Inspection" },
  "Photo Update": { icon: Camera, tint: "from-sky-500/20 to-sky-700/10 border-sky-500/30", label: "Photo" },
  Delivery: { icon: Truck, tint: "from-violet-500/20 to-violet-700/10 border-violet-500/30", label: "Delivery" },
  "Sub Issue": { icon: AlertTriangle, tint: "from-rose-500/25 to-rose-700/10 border-rose-500/40", label: "Sub Issue" },
  "Client Decision": { icon: MessageSquare, tint: "from-orange-500/25 to-amber-700/10 border-orange-500/40", label: "Decision" },
  Payment: { icon: HandCoins, tint: "from-amber-500/25 to-orange-700/10 border-amber-500/40", label: "Payment" },
  "Change Order Risk": { icon: FileSignature, tint: "from-fuchsia-500/20 to-violet-700/10 border-fuchsia-500/30", label: "Change Order" },
  "Schedule Delay": { icon: CalendarClock, tint: "from-rose-500/25 to-orange-700/10 border-rose-500/40", label: "Delay" },
};

const PRIORITY_DOT: Record<Priority, string> = {
  high: "bg-rose-500 text-rose-50",
  med: "bg-amber-500 text-amber-950",
  low: "bg-emerald-500 text-emerald-950",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function LiveFieldFeed() {
  const [storyIdx, setStoryIdx] = useState<number | null>(null);
  const [storyStep, setStoryStep] = useState(0);
  const openStory = (i: number) => {
    setStoryIdx(i);
    setStoryStep(0);
  };

  return (
    <div className="min-h-screen w-full bg-[#0a0a0c] text-zinc-100 flex justify-center md:py-6">
      {/* Phone-frame on desktop, full-bleed on mobile */}
      <div className="relative w-full md:max-w-[420px] md:rounded-[2.5rem] md:border md:border-white/10 md:shadow-2xl md:shadow-black/60 md:overflow-hidden md:min-h-[860px] bg-[#0a0a0c] pb-44">
        <Header />
        <CrewStrip />
        <ProjectStories onOpen={openStory} />
        <SmartPriorities />
        <FieldCardDeck />
        <DailyFeed />
        <QuickActionBar />

        {storyIdx !== null && (
          <StoryViewer
            story={STORIES[storyIdx]}
            step={storyStep}
            onStep={setStoryStep}
            onClose={() => setStoryIdx(null)}
            onNextProject={() => {
              const next = (storyIdx + 1) % STORIES.length;
              setStoryIdx(next);
              setStoryStep(0);
            }}
            onPrevProject={() => {
              const prev = (storyIdx - 1 + STORIES.length) % STORIES.length;
              setStoryIdx(prev);
              setStoryStep(0);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header() {
  const date = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    []
  );

  return (
    <header className="sticky top-0 z-20 bg-gradient-to-b from-[#0a0a0c] via-[#0a0a0c]/95 to-[#0a0a0c]/70 backdrop-blur-md border-b border-white/5 px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-zinc-100">
            Good afternoon, Jorge
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-400">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
            <span className="font-medium text-zinc-300">Penney Construction</span>
            <span className="text-zinc-600">·</span>
            <span className="text-orange-400 font-medium">Full plate</span>
            <span className="text-zinc-600">·</span>
            <span>20 active</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
            <Cloud className="h-3.5 w-3.5 text-sky-300" />
            <span className="font-medium text-zinc-200">52°</span>
            <span className="text-zinc-500">·</span>
            <span>{date}</span>
          </div>
          <button className="h-9 w-9 grid place-items-center rounded-full bg-white/5 border border-white/10 active:scale-95 transition">
            <Search className="h-4 w-4 text-zinc-300" />
          </button>
          <button className="relative h-9 w-9 grid place-items-center rounded-full bg-white/5 border border-white/10 active:scale-95 transition">
            <Bell className="h-4 w-4 text-zinc-300" />
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-[#0a0a0c]" />
          </button>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Crew Strip
// ---------------------------------------------------------------------------

function CrewStrip() {
  return (
    <section className="pt-4">
      <div className="flex items-center justify-between px-4 mb-2">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Live Crew</h2>
          <p className="text-[11px] text-zinc-500">{CREW.length} clocked in right now</p>
        </div>
        <button className="text-[12px] font-medium text-orange-400 active:opacity-70">
          See all
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CREW.map((c) => {
          const s = STATUS_STYLE[c.status];
          const Icon = s.icon;
          return (
            <div
              key={c.id}
              className="snap-start shrink-0 w-[180px] rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-white/10 p-3 active:scale-[0.98] transition shadow-lg shadow-black/30"
            >
              <div className="flex items-start justify-between">
                <div className="relative">
                  <div className={cn("h-11 w-11 rounded-full grid place-items-center font-semibold text-white text-sm bg-gradient-to-br", c.color)}>
                    {c.initials}
                  </div>
                  <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-zinc-950", s.dot)} />
                </div>
                <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border", s.chip)}>
                  <Icon className="h-2.5 w-2.5" />
                  {c.status}
                </span>
              </div>
              <p className="mt-2.5 text-[13px] font-semibold leading-tight">{c.name}</p>
              <p className="text-[11px] text-zinc-400 leading-tight">{c.trade}</p>
              <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-300 truncate">{c.project}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5 inline-flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {c.clockIn}
                  </p>
                </div>
                <button className="ml-2 shrink-0 h-7 w-7 grid place-items-center rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 active:scale-90 transition">
                  <MapPin className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Project Stories
// ---------------------------------------------------------------------------

function ProjectStories({ onOpen }: { onOpen: (i: number) => void }) {
  return (
    <section className="pt-4">
      <div className="flex items-center justify-between px-4 mb-2">
        <h2 className="text-[15px] font-semibold tracking-tight">Project Stories</h2>
        <span className="text-[11px] text-zinc-500">{STORIES.length} live</span>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STORIES.map((s, i) => (
          <button
            key={s.id}
            onClick={() => onOpen(i)}
            className="shrink-0 flex flex-col items-center w-16 active:scale-95 transition"
          >
            <div className={cn("relative p-[2.5px] rounded-full bg-gradient-to-tr", URGENCY_RING[s.urgency])}>
              <div className="rounded-full bg-[#0a0a0c] p-[2px]">
                <div className={cn("h-14 w-14 rounded-full grid place-items-center font-bold text-white text-sm bg-gradient-to-br", s.color)}>
                  {s.initials}
                </div>
              </div>
              {s.badge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-orange-500 text-[10px] font-bold text-white ring-2 ring-[#0a0a0c]">
                  {s.badge}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[10.5px] text-zinc-300 text-center leading-tight line-clamp-2">
              {s.project}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Smart Priorities
// ---------------------------------------------------------------------------

function SmartPriorities() {
  const toneClass: Record<string, string> = {
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-200",
    rose: "bg-rose-500/10 border-rose-500/30 text-rose-200",
    sky: "bg-sky-500/10 border-sky-500/30 text-sky-200",
    emerald: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
  };
  const iconTone: Record<string, string> = {
    amber: "text-amber-400",
    rose: "text-rose-400",
    sky: "text-sky-400",
    emerald: "text-emerald-400",
  };

  return (
    <section className="px-4 pt-2">
      <div className="rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-white/10 p-3 shadow-lg shadow-black/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-orange-400" />
            <h3 className="text-[13px] font-semibold tracking-tight">Needs your attention</h3>
          </div>
          <span className="text-[11px] text-zinc-500">{PRIORITIES.length} items</span>
        </div>
        <div className="space-y-1.5">
          {PRIORITIES.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-left active:scale-[0.99] transition",
                  toneClass[p.tone]
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", iconTone[p.tone])} />
                <span className="text-[12.5px] font-medium flex-1">{p.label}</span>
                <ChevronRight className="h-4 w-4 opacity-60" />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tinder-style Field Cards
// ---------------------------------------------------------------------------

type SwipeDir = "left" | "right" | "up";

function FieldCardDeck() {
  const [stack, setStack] = useState(FIELD_CARDS);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [exiting, setExiting] = useState<{ id: string; dir: SwipeDir } | null>(null);

  const top = stack[0];

  const completeSwipe = (dir: SwipeDir) => {
    if (!top) return;
    setExiting({ id: top.id, dir });
    window.setTimeout(() => {
      setStack((s) => s.slice(1));
      setExiting(null);
      setDrag(null);
      startRef.current = null;
    }, 220);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    setDrag({ x: e.clientX - startRef.current.x, y: e.clientY - startRef.current.y });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const { x, y } = drag;
    if (y < -100 && Math.abs(y) > Math.abs(x)) return completeSwipe("up");
    if (x > 110) return completeSwipe("right");
    if (x < -110) return completeSwipe("left");
    setDrag(null);
    startRef.current = null;
  };

  const reset = () => setStack(FIELD_CARDS);

  return (
    <section className="pt-5">
      <div className="flex items-center justify-between px-4 mb-2">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Today&apos;s Field Cards</h2>
          <p className="text-[11px] text-zinc-500">Swipe right to approve · left to dismiss · up for task</p>
        </div>
        <span className="text-[11px] font-medium text-orange-400">
          {stack.length} left
        </span>
      </div>

      <div className="px-4">
        <div className="relative h-[330px]">
          {stack.length === 0 && (
            <div className="absolute inset-0 grid place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
              <div className="text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-[13px] font-semibold">All caught up</p>
                <p className="text-[11px] text-zinc-500 mb-3">No more cards in the deck</p>
                <button
                  onClick={reset}
                  className="text-[12px] font-medium text-orange-400 active:opacity-70"
                >
                  Reload deck
                </button>
              </div>
            </div>
          )}

          {stack
            .slice(0, 3)
            .map((card, i) => {
              const isTop = i === 0;
              const isExiting = exiting?.id === card.id;
              const offset = i * 8;
              const scale = 1 - i * 0.04;

              const dx = isTop && drag ? drag.x : 0;
              const dy = isTop && drag ? drag.y : 0;
              const rot = isTop && drag ? drag.x / 16 : 0;

              const exitTransform =
                isExiting && exiting
                  ? exiting.dir === "right"
                    ? "translate(120vw, -40px) rotate(28deg)"
                    : exiting.dir === "left"
                      ? "translate(-120vw, -40px) rotate(-28deg)"
                      : "translate(0, -120vh) rotate(0deg)"
                  : `translate(${dx}px, ${dy + offset}px) rotate(${rot}deg) scale(${scale})`;

              const style = CARD_TYPE_STYLE[card.type];
              const Icon = style.icon;
              const likeOpacity = isTop && drag ? Math.max(0, Math.min(1, drag.x / 100)) : 0;
              const nopeOpacity = isTop && drag ? Math.max(0, Math.min(1, -drag.x / 100)) : 0;
              const taskOpacity = isTop && drag ? Math.max(0, Math.min(1, -drag.y / 100)) : 0;

              return (
                <div
                  key={card.id}
                  onPointerDown={isTop ? onPointerDown : undefined}
                  onPointerMove={isTop ? onPointerMove : undefined}
                  onPointerUp={isTop ? onPointerUp : undefined}
                  onPointerCancel={isTop ? onPointerUp : undefined}
                  className={cn(
                    "absolute inset-0 rounded-3xl border bg-gradient-to-br from-zinc-900 to-zinc-950 shadow-2xl shadow-black/50 select-none touch-none overflow-hidden",
                    isTop ? "cursor-grab active:cursor-grabbing z-30" : "z-10",
                    isTop && !drag && !isExiting ? "transition-transform duration-300" : "",
                    isExiting ? "transition-transform duration-200 ease-out" : ""
                  )}
                  style={{
                    transform: exitTransform,
                    transformOrigin: "center bottom",
                    zIndex: 30 - i,
                  }}
                >
                  {/* tinted bg accent */}
                  <div className={cn("absolute inset-0 bg-gradient-to-br opacity-90 pointer-events-none", style.tint)} />

                  {/* swipe overlays */}
                  {isTop && (
                    <>
                      <div
                        className="absolute top-6 left-6 rotate-[-18deg] text-emerald-400 border-2 border-emerald-400 rounded-lg px-3 py-1 font-extrabold tracking-wider text-base z-20"
                        style={{ opacity: likeOpacity }}
                      >
                        REVIEWED
                      </div>
                      <div
                        className="absolute top-6 right-6 rotate-[18deg] text-rose-400 border-2 border-rose-400 rounded-lg px-3 py-1 font-extrabold tracking-wider text-base z-20"
                        style={{ opacity: nopeOpacity }}
                      >
                        DISMISS
                      </div>
                      <div
                        className="absolute top-6 left-1/2 -translate-x-1/2 text-orange-400 border-2 border-orange-400 rounded-lg px-3 py-1 font-extrabold tracking-wider text-base z-20"
                        style={{ opacity: taskOpacity }}
                      >
                        + TASK
                      </div>
                    </>
                  )}

                  <div className="relative h-full p-5 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="h-9 w-9 rounded-xl bg-white/10 border border-white/10 grid place-items-center">
                          <Icon className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wider text-zinc-300/80 font-semibold">
                            {style.label}
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            {card.project} · {card.time}
                          </p>
                        </div>
                      </div>
                      <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full", PRIORITY_DOT[card.priority])}>
                        {card.priority}
                      </span>
                    </div>

                    <h3 className="mt-4 text-[22px] font-bold leading-tight tracking-tight">
                      {card.title}
                    </h3>

                    {card.photos > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        {Array.from({ length: Math.min(3, card.photos) }).map((_, idx) => (
                          <div
                            key={idx}
                            className="aspect-[4/3] rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/5 grid place-items-center"
                          >
                            <ImageIcon className="h-5 w-5 text-zinc-500" />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto pt-4">
                      <div className="rounded-xl bg-black/30 border border-white/5 p-3">
                        <p className="text-[10.5px] uppercase tracking-wider text-orange-300 font-semibold">
                          Suggested next action
                        </p>
                        <p className="text-[13px] text-zinc-200 mt-0.5 leading-snug">
                          {card.suggested}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400">
                        <span>By {card.postedBy}</span>
                        <span>Tap for details</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
            .reverse()}
        </div>

        {/* Action buttons */}
        {top && (
          <div className="mt-4 flex items-center justify-center gap-5">
            <button
              onClick={() => completeSwipe("left")}
              className="h-12 w-12 rounded-full bg-zinc-900 border border-white/10 grid place-items-center active:scale-90 transition shadow-lg shadow-black/40"
            >
              <X className="h-5 w-5 text-rose-400" />
            </button>
            <button
              onClick={() => completeSwipe("up")}
              className="h-14 w-14 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 grid place-items-center active:scale-90 transition shadow-lg shadow-orange-600/40"
            >
              <ChevronUp className="h-6 w-6 text-white" />
            </button>
            <button
              onClick={() => completeSwipe("right")}
              className="h-12 w-12 rounded-full bg-zinc-900 border border-white/10 grid place-items-center active:scale-90 transition shadow-lg shadow-black/40"
            >
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Daily Feed
// ---------------------------------------------------------------------------

function DailyFeed() {
  return (
    <section className="pt-6 px-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Today&apos;s Feed</h2>
          <p className="text-[11px] text-zinc-500">Everything that happened across all sites</p>
        </div>
        <button className="text-[12px] font-medium text-orange-400 active:opacity-70">
          Filter
        </button>
      </div>
      <div className="space-y-2.5">
        {FEED_ITEMS.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-white/10 p-3 active:scale-[0.99] transition"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div className={cn("h-7 w-7 rounded-full text-[11px] font-semibold text-white grid place-items-center shrink-0", item.by.color)}>
                {item.by.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="font-medium text-zinc-200">{item.project}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{item.time}</span>
                </div>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30">
                {item.type}
              </span>
            </div>
            <p className="text-[13px] text-zinc-200 leading-snug">{item.summary}</p>
            <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center gap-3 text-[11px] text-zinc-500">
              {item.attachments > 0 && (
                <span className="inline-flex items-center gap-1">
                  <ImageIcon className="h-3 w-3" />
                  {item.attachments}
                </span>
              )}
              {item.comments > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {item.comments}
                </span>
              )}
              {item.tasks > 0 && (
                <span className="inline-flex items-center gap-1">
                  <ListChecks className="h-3 w-3" />
                  {item.tasks}
                </span>
              )}
              <span className="ml-auto text-orange-400 font-medium">View →</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Quick Action Bar (sticky above bottom nav)
// ---------------------------------------------------------------------------

function QuickActionBar() {
  const actions = [
    { icon: Hammer, label: "Log" },
    { icon: Mic, label: "Voice" },
    { icon: Camera, label: "Photo" },
    { icon: Plus, label: "Task" },
    { icon: Send, label: "Update" },
  ];
  return (
    <div className="fixed left-0 right-0 z-30 bottom-[calc(env(safe-area-inset-bottom,0px)+78px)] px-3 md:absolute md:bottom-4 md:px-3 md:left-0 md:right-0">
      <div className="rounded-2xl bg-zinc-950/85 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/60 px-2 py-2">
        <div className="grid grid-cols-5 gap-1">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                className="flex flex-col items-center gap-1 py-1.5 rounded-xl active:bg-white/5 active:scale-95 transition"
              >
                <span className="h-9 w-9 grid place-items-center rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-600/10 border border-orange-500/30">
                  <Icon className="h-4 w-4 text-orange-300" />
                </span>
                <span className="text-[10px] text-zinc-300 font-medium">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story Viewer
// ---------------------------------------------------------------------------

function StoryViewer({
  story,
  step,
  onStep,
  onClose,
  onNextProject,
  onPrevProject,
}: {
  story: (typeof STORIES)[number];
  step: number;
  onStep: (n: number) => void;
  onClose: () => void;
  onNextProject: () => void;
  onPrevProject: () => void;
}) {
  const update = story.updates[step];

  const handleTap = (e: React.MouseEvent) => {
    const x = e.clientX;
    const w = window.innerWidth;
    if (x < w / 3) {
      if (step === 0) onPrevProject();
      else onStep(step - 1);
    } else if (x > (2 * w) / 3) {
      if (step === story.updates.length - 1) onNextProject();
      else onStep(step + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" onClick={handleTap}>
      {/* progress bars */}
      <div className="flex gap-1 px-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
        {story.updates.map((_, i) => (
          <div key={i} className="h-0.5 flex-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full bg-white",
                i < step ? "w-full" : i === step ? "w-1/2" : "w-0"
              )}
            />
          </div>
        ))}
      </div>

      {/* header */}
      <div className="flex items-center gap-2 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className={cn("h-9 w-9 rounded-full grid place-items-center text-[13px] font-bold text-white bg-gradient-to-br", story.color)}>
          {story.initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold leading-tight text-white truncate">{story.project}</p>
          <p className="text-[11px] text-zinc-300 leading-tight">
            {update.postedBy} · {update.time}
          </p>
        </div>
        <button
          onClick={onClose}
          className="h-9 w-9 grid place-items-center rounded-full bg-white/10 active:scale-90 transition"
        >
          <X className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* media */}
      <div className="flex-1 grid place-items-center px-6">
        <div className={cn("w-full max-w-md aspect-[4/5] rounded-3xl bg-gradient-to-br grid place-items-center text-white shadow-2xl", story.color)}>
          <div className="text-center px-6">
            <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-70" />
            <p className="text-[15px] font-semibold leading-snug">{update.note}</p>
          </div>
        </div>
      </div>

      {/* actions */}
      <div
        className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="flex-1 h-11 rounded-full bg-white/10 border border-white/15 text-white text-[13px] font-medium active:scale-95 transition">
          Comment
        </button>
        <button className="flex-1 h-11 rounded-full bg-white/10 border border-white/15 text-white text-[13px] font-medium active:scale-95 transition">
          Add Task
        </button>
        <button className="flex-1 h-11 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-white text-[13px] font-semibold active:scale-95 transition shadow-lg shadow-orange-600/40">
          Approve
        </button>
      </div>
    </div>
  );
}

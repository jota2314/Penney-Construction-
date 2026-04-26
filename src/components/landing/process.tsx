"use client";

import { useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  Compass,
  ClipboardList,
  Hammer,
  Handshake,
  type LucideIcon,
} from "lucide-react";

const STEPS = [
  {
    n: "01",
    icon: Compass,
    title: "Walkthrough",
    body:
      "We come to your home, listen to what you want, and talk honestly about scope, budget, and timeline. No spreadsheets yet — just conversation.",
    bullets: ["Same-week site visit", "Honest scope conversation", "No-pressure quote"],
    accent: "from-amber-500/40 via-amber-500/10",
  },
  {
    n: "02",
    icon: ClipboardList,
    title: "Estimate",
    body:
      "A line-by-line proposal — no black boxes. You see exactly what each trade costs, what's allowance, and where the schedule gets tight.",
    bullets: ["Line-by-line pricing", "Vetted sub quotes", "Allowances spelled out"],
    accent: "from-orange-500/40 via-orange-500/10",
  },
  {
    n: "03",
    icon: Hammer,
    title: "Build",
    body:
      "Your project runs with a dedicated PM, vetted subs, and a daily schedule you can actually follow. Daily updates, weekly check-ins, no surprises.",
    bullets: ["Dedicated project manager", "Daily site updates", "Clean job site, every day"],
    accent: "from-amber-600/40 via-amber-600/10",
  },
  {
    n: "04",
    icon: Handshake,
    title: "Handoff",
    body:
      "Punch list, final walkthrough, warranty package. We stand behind the work long after the last invoice clears.",
    bullets: ["Detailed punch list", "Walkthrough with you", "Two-year workmanship warranty"],
    accent: "from-yellow-500/40 via-yellow-500/10",
  },
];

export function Process() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  return (
    <section
      id="process"
      ref={containerRef}
      className="relative border-y border-white/5 bg-neutral-900/40"
      style={{ height: `${STEPS.length * 100}vh` }}
    >
      {/* Sticky stage */}
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        {/* Section eyebrow */}
        <div className="absolute left-1/2 top-10 z-20 -translate-x-1/2 text-center sm:top-14">
          <div className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
            <span className="h-px w-8 bg-amber-400/60" />
            How we work
            <span className="h-px w-8 bg-amber-400/60" />
          </div>
          <h2 className="mt-3 font-display text-2xl font-semibold text-white sm:text-3xl">
            Four steps. Zero surprises.
          </h2>
        </div>

        {/* Progress rail */}
        <ProgressRail scrollYProgress={scrollYProgress} />

        {/* Stages */}
        <div className="relative w-full">
          {STEPS.map((step, i) => (
            <Stage
              key={step.n}
              step={step}
              index={i}
              total={STEPS.length}
              scrollYProgress={scrollYProgress}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Stage({
  step,
  index,
  total,
  scrollYProgress,
}: {
  step: (typeof STEPS)[number];
  index: number;
  total: number;
  scrollYProgress: MotionValue<number>;
}) {
  const segment = 1 / total;
  const start = index * segment;
  const end = start + segment;

  // Each step fades in then out as scroll passes through its segment
  const opacity = useTransform(
    scrollYProgress,
    [start - 0.05, start + segment * 0.2, end - segment * 0.2, end + 0.05],
    [0, 1, 1, 0]
  );
  const y = useTransform(
    scrollYProgress,
    [start, start + segment * 0.5, end],
    [60, 0, -60]
  );
  const scale = useTransform(
    scrollYProgress,
    [start, start + segment * 0.5, end],
    [0.96, 1, 0.96]
  );
  const numberY = useTransform(
    scrollYProgress,
    [start, end],
    ["10%", "-10%"]
  );

  const Icon: LucideIcon = step.icon;

  return (
    <motion.div
      style={{ opacity }}
      className="absolute inset-0 flex items-center justify-center px-5 sm:px-8"
    >
      {/* Ambient color wash for this step */}
      <div
        aria-hidden
        className={`absolute inset-0 -z-10 bg-gradient-to-br ${step.accent} to-transparent opacity-60`}
      />

      <motion.div
        style={{ y, scale }}
        className="mx-auto grid w-full max-w-7xl items-center gap-10 lg:grid-cols-12 lg:gap-16"
      >
        {/* Big number column */}
        <div className="relative lg:col-span-5">
          <motion.div
            style={{ y: numberY }}
            className="pointer-events-none select-none font-display text-[180px] font-bold leading-none text-white/[0.06] sm:text-[260px] lg:text-[320px]"
          >
            {step.n}
          </motion.div>
          <div className="absolute inset-0 flex items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/30 backdrop-blur-sm sm:h-24 sm:w-24">
              <Icon className="h-9 w-9 text-amber-400 sm:h-11 sm:w-11" />
            </div>
          </div>
        </div>

        {/* Content column */}
        <div className="lg:col-span-7">
          <div className="text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
            Step {step.n} of {String(total).padStart(2, "0")}
          </div>
          <h3 className="mt-4 font-display text-5xl font-semibold leading-[1.05] text-white sm:text-6xl lg:text-7xl">
            {step.title}
          </h3>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70 sm:text-xl">
            {step.body}
          </p>
          <ul className="mt-8 space-y-3">
            {step.bullets.map((b, i) => (
              <motion.li
                key={b}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: false, margin: "-100px" }}
                transition={{ duration: 0.4, delay: 0.15 + i * 0.08 }}
                className="flex items-center gap-3 text-base text-white/80"
              >
                <span className="h-px w-6 bg-amber-400" />
                {b}
              </motion.li>
            ))}
          </ul>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ProgressRail({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) {
  const height = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <div className="absolute right-6 top-1/2 z-20 hidden -translate-y-1/2 sm:block">
      <div className="relative h-64 w-px bg-white/10">
        <motion.div
          style={{ height }}
          className="absolute inset-x-0 top-0 origin-top bg-amber-400"
        />
        {STEPS.map((s, i) => {
          const tick = i / (STEPS.length - 1);
          return <Tick key={s.n} progress={scrollYProgress} at={tick} label={s.n} />;
        })}
      </div>
    </div>
  );
}

function Tick({
  progress,
  at,
  label,
}: {
  progress: MotionValue<number>;
  at: number;
  label: string;
}) {
  const scale = useTransform(progress, [at - 0.05, at, at + 0.05], [1, 1.6, 1]);
  const bg = useTransform(
    progress,
    [0, at, 1],
    ["#27272a", "#fbbf24", "#fbbf24"]
  );
  return (
    <motion.div
      style={{ top: `${at * 100}%`, scale, backgroundColor: bg }}
      className="absolute -left-[3px] h-1.5 w-1.5 -translate-y-1/2 rounded-full"
    >
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-semibold tracking-widest text-white/40">
        {label}
      </span>
    </motion.div>
  );
}

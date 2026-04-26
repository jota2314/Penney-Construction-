"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
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
  const railRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: railRef,
    offset: ["start end", "end start"],
  });
  const railHeight = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section
      id="process"
      ref={railRef}
      className="relative border-y border-white/5 bg-neutral-900/40 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
            <span className="h-px w-8 bg-amber-400/60" />
            How we work
            <span className="h-px w-8 bg-amber-400/60" />
          </div>
          <h2 className="mt-5 font-display text-4xl font-semibold leading-[1.05] text-white sm:text-5xl">
            Four steps. Zero surprises.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            From first handshake to final walkthrough, you always know what&apos;s next.
          </p>
        </div>

        <div className="relative mt-20">
          {/* Vertical rail */}
          <div
            aria-hidden
            className="absolute left-7 top-0 hidden h-full w-px bg-white/10 sm:block lg:left-1/2 lg:-translate-x-1/2"
          />
          <motion.div
            aria-hidden
            style={{ height: railHeight }}
            className="absolute left-7 top-0 hidden w-px origin-top bg-amber-400 sm:block lg:left-1/2 lg:-translate-x-1/2"
          />

          <div className="space-y-24 sm:space-y-32">
            {STEPS.map((step, i) => (
              <Step key={step.n} step={step} index={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  const Icon: LucideIcon = step.icon;
  const isEven = index % 2 === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 60 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-120px" }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="relative grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-20"
    >
      {/* Rail node */}
      <div
        aria-hidden
        className="absolute left-7 top-12 hidden h-3 w-3 -translate-x-1/2 rounded-full bg-amber-400 ring-4 ring-neutral-900 sm:block lg:left-1/2"
      />

      {/* Big number side */}
      <div
        className={`relative ${
          isEven ? "lg:order-1" : "lg:order-2 lg:text-right"
        } pl-16 sm:pl-20 lg:pl-0`}
      >
        <div
          className={`pointer-events-none select-none font-display text-[140px] font-bold leading-none text-white/[0.06] sm:text-[200px] lg:text-[260px] ${
            isEven ? "" : "lg:text-right"
          }`}
        >
          {step.n}
        </div>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className={`absolute top-1/2 -translate-y-1/2 ${
            isEven ? "left-16 sm:left-24 lg:left-12" : "left-16 sm:left-24 lg:left-auto lg:right-12"
          }`}
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/30 backdrop-blur-sm sm:h-24 sm:w-24">
            <Icon className="h-9 w-9 text-amber-400 sm:h-11 sm:w-11" />
          </div>
        </motion.div>
      </div>

      {/* Content side */}
      <div className={`pl-16 sm:pl-20 lg:pl-0 ${isEven ? "lg:order-2" : "lg:order-1"}`}>
        <div className="text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
          Step {step.n} of {String(STEPS.length).padStart(2, "0")}
        </div>
        <h3 className="mt-3 font-display text-4xl font-semibold leading-[1.05] text-white sm:text-5xl">
          {step.title}
        </h3>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/70">{step.body}</p>
        <ul className="mt-8 space-y-3">
          {step.bullets.map((b, i) => (
            <motion.li
              key={b}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
              className="flex items-center gap-3 text-base text-white/80"
            >
              <span className="h-px w-6 bg-amber-400" />
              {b}
            </motion.li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

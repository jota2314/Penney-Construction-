"use client";

import { ArrowRight } from "lucide-react";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { CountUp, MagneticBtn } from "./motion";

const STATS = [
  { value: 20, suffix: "+", label: "Years building" },
  { value: 150, suffix: "+", label: "Homes finished" },
  { value: 1, suffix: "", label: "Project per PM" },
  { value: 0, suffix: "A+", label: "BBB accredited", noNumber: true },
];

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const yBg = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const yText = useTransform(scrollYProgress, [0, 1], ["0%", "-15%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <section ref={ref} className="relative isolate overflow-hidden pt-16">
      {/* Animated ambient backdrop */}
      <motion.div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          y: yBg,
          background:
            "radial-gradient(1200px 600px at 75% 0%, rgba(217,119,6,0.22), transparent 60%)," +
            "radial-gradient(900px 500px at 15% 30%, rgba(234,88,12,0.14), transparent 60%)," +
            "linear-gradient(180deg, #0A0A0A 0%, #0F0F10 100%)",
        }}
      />

      {/* Grid lines */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Floating orbs */}
      <motion.div
        aria-hidden
        className="absolute right-[10%] top-[15%] -z-10 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl"
        animate={{ y: [0, -30, 0], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute left-[5%] top-[55%] -z-10 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl"
        animate={{ y: [0, 40, 0], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      />

      <motion.div
        style={{ y: yText, opacity }}
        className="mx-auto max-w-7xl px-5 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28 lg:pt-36"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90"
        >
          <motion.span
            className="h-px bg-amber-400/60"
            initial={{ width: 0 }}
            animate={{ width: "2rem" }}
            transition={{ duration: 0.8, delay: 0.3 }}
          />
          Residential General Contractor · Est. North Shore, MA
        </motion.div>

        <h1 className="mt-8 max-w-5xl font-display text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-7xl lg:text-[88px]">
          <AnimatedWords text="Built right." delay={0.2} />
          <br />
          <AnimatedWords text="On the " delay={0.5} className="text-white/60" />
          <span className="relative inline-block">
            <motion.span
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.7 }}
              className="relative z-10 italic text-amber-400"
            >
              North Shore
            </motion.span>
            <motion.span
              aria-hidden
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, delay: 1.2, ease: "easeOut" }}
              style={{ originX: 0 }}
              className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded-sm bg-amber-500/20 sm:h-4"
            />
          </span>
          <AnimatedWords text="." delay={0.9} className="text-white/60" />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1, ease: "easeOut" }}
          className="mt-8 max-w-2xl text-lg leading-relaxed text-white/70 sm:text-xl"
        >
          Penney Construction builds kitchens, additions, and whole-home renovations for families
          north of Boston. Owner-led, meticulously scheduled, and finished the way you&apos;d build
          it yourself.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1.2, ease: "easeOut" }}
          className="mt-10 flex flex-wrap items-center gap-3 sm:gap-4"
        >
          <MagneticBtn
            href="#contact"
            className="group inline-flex items-center gap-2 rounded-full bg-amber-500 px-7 py-4 text-base font-semibold text-neutral-950 shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-400 hover:shadow-amber-500/40"
          >
            Request a consultation
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </MagneticBtn>
          <a
            href="#work"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-7 py-4 text-base font-medium text-white/90 transition-colors hover:border-amber-400/60 hover:text-amber-400"
          >
            See our work
          </a>
        </motion.div>

        {/* Stats */}
        <dl className="mt-20 grid max-w-3xl grid-cols-2 gap-x-10 gap-y-10 sm:grid-cols-4">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.4 + i * 0.1 }}
            >
              <dt className="font-display text-4xl font-semibold text-white sm:text-5xl">
                {s.noNumber ? s.suffix : <CountUp to={s.value} suffix={s.suffix} duration={1.4} />}
              </dt>
              <dd className="mt-2 text-sm text-white/50">{s.label}</dd>
            </motion.div>
          ))}
        </dl>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 1 }}
        className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 sm:block"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="flex h-10 w-6 items-start justify-center rounded-full border border-white/20 p-1.5"
        >
          <span className="h-1.5 w-0.5 rounded-full bg-amber-400" />
        </motion.div>
      </motion.div>
    </section>
  );
}

function AnimatedWords({
  text,
  delay = 0,
  className,
}: {
  text: string;
  delay?: number;
  className?: string;
}) {
  return (
    <span className={className}>
      {text.split(" ").map((word, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <motion.span
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.7, delay: delay + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block"
          >
            {word}
            {i < text.split(" ").length - 1 && " "}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

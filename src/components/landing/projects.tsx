"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Home as HomeIcon, MapPin } from "lucide-react";
import { Reveal } from "./motion";

const PROJECTS = [
  {
    title: "Coastal Kitchen & Great Room",
    town: "Manchester-by-the-Sea",
    scope: "Full kitchen remodel, open-concept rebuild",
    meta: "2,400 sf · 7 months",
    accent: "from-amber-500/30 via-amber-500/5 to-transparent",
  },
  {
    title: "Shingle-Style Rear Addition",
    town: "Hamilton",
    scope: "Primary suite, mudroom, rear porch",
    meta: "1,100 sf addition · 2025",
    accent: "from-orange-500/30 via-orange-500/5 to-transparent",
  },
  {
    title: "Historic Home Restoration",
    town: "Ipswich",
    scope: "Whole-home rebuild w/ original millwork saved",
    meta: "Built 1847 · Finished 2024",
    accent: "from-amber-600/30 via-amber-600/5 to-transparent",
  },
  {
    title: "Modern Farmhouse Bath Suite",
    town: "Topsfield",
    scope: "Owner's bath, dressing room, laundry",
    meta: "620 sf · 10 weeks",
    accent: "from-yellow-600/30 via-yellow-600/5 to-transparent",
  },
  {
    title: "Waterfront Deck & Screened Porch",
    town: "Essex",
    scope: "Mahogany deck, cedar screened porch",
    meta: "1,250 sf · 12 weeks",
    accent: "from-amber-400/30 via-amber-400/5 to-transparent",
  },
  {
    title: "Second-Story Addition",
    town: "Beverly",
    scope: "Three bedrooms, two baths, new roof line",
    meta: "1,600 sf · 2024",
    accent: "from-orange-600/30 via-orange-600/5 to-transparent",
  },
];

export function Projects() {
  return (
    <section id="work" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <SectionHeader
            eyebrow="Recent work"
            title="A portfolio built one home at a time."
            blurb="Every project is different. Every client is the only one we're building for that week."
          />
        </Reveal>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
          }}
          className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {PROJECTS.map((p, i) => (
            <ProjectCard key={p.title} project={p} index={i} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function ProjectCard({
  project,
  index,
}: {
  project: (typeof PROJECTS)[number];
  index: number;
}) {
  const ref = useRef<HTMLElement>(null);

  // Tilt
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 200, damping: 20 });
  const sy = useSpring(my, { stiffness: 200, damping: 20 });
  const rotX = useTransform(sy, [-0.5, 0.5], [6, -6]);
  const rotY = useTransform(sx, [-0.5, 0.5], [-6, 6]);

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width - 0.5);
    my.set((e.clientY - rect.top) / rect.height - 0.5);
  }
  function onLeave() {
    mx.set(0);
    my.set(0);
  }

  return (
    <motion.article
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      variants={{
        hidden: { opacity: 0, y: 40 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
      }}
      style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 1000 }}
      className="group relative overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 transition-colors hover:border-amber-400/40"
    >
      {/* Image / placeholder */}
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        <motion.div
          className={`absolute inset-0 bg-gradient-to-br ${project.accent}`}
          whileHover={{ scale: 1.06 }}
          transition={{ duration: 0.6 }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            initial={{ rotate: 0 }}
            whileHover={{ rotate: 6, scale: 1.15 }}
            transition={{ duration: 0.5 }}
          >
            <HomeIcon className="h-14 w-14 text-white/10 transition-colors group-hover:text-amber-400/40" />
          </motion.div>
        </div>
        <div className="absolute left-4 top-4 rounded-full bg-neutral-950/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400 backdrop-blur-sm">
          Project {String(index + 1).padStart(2, "0")}
        </div>
        {/* Sheen on hover */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={{ x: "-100%" }}
          whileHover={{ x: "100%" }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          style={{
            background:
              "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.08) 50%, transparent 70%)",
          }}
        />
      </div>

      <div className="p-6">
        <div className="flex items-center gap-2 text-xs font-medium text-amber-400/80">
          <MapPin className="h-3.5 w-3.5" />
          {project.town}
        </div>
        <h3 className="mt-2 font-display text-2xl font-semibold text-white">{project.title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-white/60">{project.scope}</p>
        <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
          <span className="text-xs text-white/40">{project.meta}</span>
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            whileHover={{ opacity: 1, x: 0 }}
            className="text-xs font-medium text-amber-400 opacity-0 transition-opacity group-hover:opacity-100"
          >
            Details →
          </motion.span>
        </div>
      </div>
    </motion.article>
  );
}

function SectionHeader({
  eyebrow,
  title,
  blurb,
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
        <span className="h-px w-8 bg-amber-400/60" />
        {eyebrow}
        <span className="h-px w-8 bg-amber-400/60" />
      </div>
      <h2 className="mt-5 font-display text-4xl font-semibold leading-[1.05] text-white sm:text-5xl">
        {title}
      </h2>
      {blurb && <p className="mt-5 text-base leading-relaxed text-white/60 sm:text-lg">{blurb}</p>}
    </div>
  );
}

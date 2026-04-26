"use client";

import { motion } from "framer-motion";
import { MapPin, Phone, Mail, ShieldCheck, Award } from "lucide-react";
import { ContactForm } from "./contact-form";
import { Reveal } from "./motion";

const SERVING = [
  "Beverly",
  "Hamilton",
  "Wenham",
  "Ipswich",
  "Essex",
  "Manchester-by-the-Sea",
  "Gloucester",
  "Rockport",
  "Topsfield",
  "Boxford",
  "Marblehead",
  "Salem",
];

const CAPABILITIES = [
  "Kitchens",
  "Bathrooms",
  "Additions",
  "Whole-Home Renovations",
  "Primary Suites",
  "Finished Basements",
  "Custom Millwork",
  "Decks & Porches",
  "Siding & Exteriors",
  "Windows & Doors",
  "Historic Restoration",
  "New Construction",
];

export function TrustStrip() {
  const items = [
    { icon: ShieldCheck, bold: "MA Licensed & Insured", rest: " · CS-XXXXXX · HIC-XXXXXX" },
    { icon: Award, bold: "Family-owned", rest: " · Owner on every job" },
    { icon: MapPin, bold: "Serving Essex County", rest: " · and surrounding towns" },
  ];
  return (
    <section className="border-y border-white/5 bg-neutral-900/40">
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.12 } },
        }}
        className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-5 py-8 text-sm text-white/60 sm:grid-cols-3 sm:px-8"
      >
        {items.map(({ icon: Icon, bold, rest }) => (
          <motion.div
            key={bold}
            variants={{
              hidden: { opacity: 0, y: 12 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
            }}
            className="flex items-center gap-3"
          >
            <Icon className="h-5 w-5 text-amber-400" />
            <span>
              <span className="text-white">{bold}</span>
              {rest}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

export function Capabilities() {
  return (
    <section id="capabilities" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-16 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <SectionHeader
              eyebrow="Capabilities"
              title="One crew, one standard."
              blurb="We run a tight list of trades we trust. Every job on the North Shore, every trade vetted by us."
              align="left"
            />
          </Reveal>

          <div className="lg:col-span-7">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } },
              }}
              className="flex flex-wrap gap-3"
            >
              {CAPABILITIES.map((c) => (
                <motion.span
                  key={c}
                  variants={{
                    hidden: { opacity: 0, scale: 0.85, y: 8 },
                    visible: {
                      opacity: 1,
                      scale: 1,
                      y: 0,
                      transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
                    },
                  }}
                  whileHover={{ scale: 1.05, y: -2 }}
                  className="cursor-default rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 transition-colors hover:border-amber-400/40 hover:bg-amber-500/10 hover:text-amber-400"
                >
                  {c}
                </motion.span>
              ))}
            </motion.div>

            <Reveal delay={0.2}>
              <div className="mt-10 rounded-2xl border border-white/10 bg-neutral-900/60 p-6">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-amber-400">
                  <MapPin className="h-4 w-4" />
                  Serving
                </div>
                <p className="mt-3 leading-relaxed text-white/70">
                  {SERVING.join(" · ")}
                  <span className="text-white/40"> · and neighboring towns.</span>
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

export function OwnerLetter() {
  return (
    <section
      id="about"
      className="relative overflow-hidden border-y border-white/5 bg-neutral-900/40 py-24 sm:py-32"
    >
      <motion.div
        aria-hidden
        className="absolute inset-0 -z-10"
        animate={{
          backgroundPosition: ["0% 0%", "100% 100%"],
        }}
        transition={{ duration: 30, repeat: Infinity, repeatType: "reverse" }}
        style={{
          background:
            "radial-gradient(800px 400px at 20% 20%, rgba(217,119,6,0.18), transparent 60%)",
          backgroundSize: "200% 200%",
        }}
      />

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-20">
          <Reveal className="lg:col-span-4">
            <div className="relative mx-auto aspect-[3/4] max-w-xs overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-amber-500/20 to-transparent">
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.08]"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-end p-6 text-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="mb-3 h-16 w-16 rounded-full bg-white/5 ring-1 ring-white/15"
                />
                <div className="text-xs font-medium uppercase tracking-widest text-amber-400">
                  Ryan Penney
                </div>
                <div className="mt-1 text-xs text-white/50">Owner · General Contractor</div>
              </div>
            </div>
          </Reveal>

          <div className="lg:col-span-8">
            <Reveal>
              <div className="text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
                A note from Ryan
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-white sm:text-5xl">
                &ldquo;Your home isn&apos;t a job site to me. It&apos;s where your kids wake
                up.&rdquo;
              </h2>
            </Reveal>
            <div className="mt-8 space-y-5 text-base leading-relaxed text-white/70 sm:text-lg">
              <Reveal delay={0.2}>
                <p>
                  I started Penney Construction because I wanted to build the way I&apos;d want
                  someone building on my own house. That means a clean job site, honest numbers,
                  and a real human answering the phone when something comes up.
                </p>
              </Reveal>
              <Reveal delay={0.3}>
                <p>
                  We work on the North Shore because it&apos;s home. I know the inspectors, the
                  suppliers, the weather, and the quirks of a 19th-century Ipswich colonial. Every
                  project gets my personal attention — not because I have to, but because that&apos;s
                  the only way I know how to do this.
                </p>
              </Reveal>
              <Reveal delay={0.4}>
                <p className="font-display italic text-white">— Ryan Penney, Owner</p>
              </Reveal>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ContactSection() {
  return (
    <section id="contact" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-16 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <SectionHeader
              eyebrow="Start a project"
              title="Let's talk about your home."
              blurb="Tell us what you're dreaming up. We'll come by for a walkthrough — no pressure, no sales pitch."
              align="left"
            />

            <div className="mt-10 space-y-5">
              <ContactRow
                icon={Phone}
                label="Phone"
                value="(978) 555-1234"
                href="tel:+19785551234"
                delay={0.1}
              />
              <ContactRow
                icon={Mail}
                label="Email"
                value="hello@penneyconstructioninc.com"
                href="mailto:hello@penneyconstructioninc.com"
                delay={0.2}
              />
              <ContactRow
                icon={MapPin}
                label="Office"
                value="By appointment · North Shore, MA"
                delay={0.3}
              />
            </div>
          </Reveal>

          <Reveal className="lg:col-span-7" delay={0.2}>
            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-neutral-900 to-neutral-950 p-6 sm:p-10">
              <ContactForm />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  href,
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string;
  delay?: number;
}) {
  const inner = (
    <>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20 transition-transform group-hover:scale-110">
        <Icon className="h-5 w-5 text-amber-400" />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-widest text-white/40">{label}</div>
        <div className="mt-0.5 text-base font-medium text-white group-hover:text-amber-400">
          {value}
        </div>
      </div>
    </>
  );

  const classes =
    "group flex items-start gap-4 rounded-xl border border-transparent p-3 transition-colors hover:border-white/10 hover:bg-white/5";

  const content = href ? (
    <a href={href} className={classes}>
      {inner}
    </a>
  ) : (
    <div className={classes}>{inner}</div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {content}
    </motion.div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  blurb,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
  align?: "center" | "left";
}) {
  const alignCls = align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <div className={`${alignCls} max-w-2xl`}>
      <div
        className={`flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90 ${
          align === "center" ? "justify-center" : ""
        }`}
      >
        {align === "center" && <span className="h-px w-8 bg-amber-400/60" />}
        {eyebrow}
        {align === "center" && <span className="h-px w-8 bg-amber-400/60" />}
      </div>
      <h2 className="mt-5 font-display text-4xl font-semibold leading-[1.05] text-white sm:text-5xl">
        {title}
      </h2>
      {blurb && <p className="mt-5 text-base leading-relaxed text-white/60 sm:text-lg">{blurb}</p>}
    </div>
  );
}

"use client";

import { motion } from "framer-motion";

const ITEMS = [
  { label: "Carriage houses", italic: true },
  { label: "Outdoor living", italic: false },
  { label: "Kitchens", italic: false },
  { label: "Baths", italic: true },
  { label: "Additions", italic: false },
  { label: "Whole-home renovations", italic: true },
  { label: "Primary suites", italic: false },
  { label: "Custom millwork", italic: true },
  { label: "Decks & porches", italic: false },
  { label: "Historic restoration", italic: true },
  { label: "New construction", italic: false },
  { label: "Finished basements", italic: true },
];

function Sparkle() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-3 w-3 shrink-0 text-amber-400/80"
      fill="currentColor"
    >
      <path d="M12 2 L13.6 9.4 L21 11 L13.6 12.6 L12 20 L10.4 12.6 L3 11 L10.4 9.4 Z" />
    </svg>
  );
}

export function CapabilitiesMarquee() {
  // Duplicate the list so the loop is seamless
  const loop = [...ITEMS, ...ITEMS];

  return (
    <section
      aria-label="What we build"
      className="relative overflow-hidden border-y border-white/10 bg-neutral-900/60 py-7"
    >
      {/* Edge fades */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-neutral-900 to-transparent sm:w-40"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-neutral-900 to-transparent sm:w-40"
      />

      <motion.div
        className="flex w-max items-center gap-12 sm:gap-16"
        animate={{ x: ["0%", "-50%"] }}
        transition={{
          duration: 60,
          ease: "linear",
          repeat: Infinity,
        }}
      >
        {loop.map((item, i) => (
          <div key={`${item.label}-${i}`} className="flex items-center gap-12 sm:gap-16">
            <span
              className={`whitespace-nowrap font-display text-2xl sm:text-3xl lg:text-4xl ${
                item.italic ? "italic text-amber-400" : "text-white/90"
              }`}
            >
              {item.label}
            </span>
            <Sparkle />
          </div>
        ))}
      </motion.div>
    </section>
  );
}

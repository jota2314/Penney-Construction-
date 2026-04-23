"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Phone, Menu, X, LogIn } from "lucide-react";

const LINKS = [
  { label: "Work", href: "#work" },
  { label: "Process", href: "#process" },
  { label: "About", href: "#about" },
  { label: "Contact", href: "#contact" },
];

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/10 bg-neutral-950/80 backdrop-blur-md"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-3">
          <Image
            src="/logo.jpg"
            alt="Penney Construction"
            width={36}
            height={36}
            className="h-9 w-9 rounded-sm object-cover"
            priority
          />
          <span className="font-display text-lg font-semibold tracking-[0.18em] text-white">
            PENNEY
          </span>
        </a>

        <nav className="hidden items-center gap-9 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-white/70 transition-colors hover:text-amber-400"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href="tel:+19785551234"
            className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:border-amber-400/60 hover:text-amber-400"
          >
            <Phone className="h-4 w-4" />
            (978) 555-1234
          </a>
          <a
            href="/login"
            className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:border-amber-400/60 hover:text-amber-400"
          >
            <LogIn className="h-4 w-4" />
            Sign in
          </a>
          <a
            href="#contact"
            className="rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400"
          >
            Start a project
          </a>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white md:hidden"
          aria-label="Menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden">
          <div className="space-y-1 border-t border-white/10 bg-neutral-950 px-5 pb-6 pt-4">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-3 text-base font-medium text-white/90 hover:bg-white/5"
              >
                {l.label}
              </a>
            ))}
            <a
              href="tel:+19785551234"
              className="mt-3 flex items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-white/80"
            >
              <Phone className="h-4 w-4" />
              (978) 555-1234
            </a>
            <a
              href="/login"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-white/80 hover:bg-white/5"
            >
              <LogIn className="h-4 w-4" />
              Sign in
            </a>
            <a
              href="#contact"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-full bg-amber-500 px-5 py-3 text-center text-base font-semibold text-neutral-950"
            >
              Start a project
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

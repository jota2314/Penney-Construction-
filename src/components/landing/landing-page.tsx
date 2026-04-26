import Image from "next/image";
import { SiteNav } from "./site-nav";
import { Hero } from "./hero";
import { Projects } from "./projects";
import { Process } from "./process";
import { TrustStrip, Capabilities, OwnerLetter, ContactSection } from "./sections";

export function LandingPage() {
  return (
    <div id="top" className="min-h-screen bg-neutral-950 font-sans text-white">
      <SiteNav />

      <Hero />
      <TrustStrip />
      <Projects />
      <Process />
      <Capabilities />
      <OwnerLetter />
      <ContactSection />
      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-white/5 bg-neutral-950">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="flex flex-col justify-between gap-10 lg:flex-row">
          <div className="max-w-md">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.jpg"
                alt="Penney Construction"
                width={40}
                height={40}
                className="h-10 w-10 rounded-sm object-cover"
              />
              <span className="font-display text-xl font-semibold tracking-[0.18em] text-white">
                PENNEY
              </span>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-white/50">
              Penney Construction, Inc. — a family-owned residential general contractor building
              the North Shore of Massachusetts one home at a time.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <FooterCol
              title="Work"
              links={[
                { label: "Portfolio", href: "#work" },
                { label: "Process", href: "#process" },
                { label: "Capabilities", href: "#capabilities" },
              ]}
            />
            <FooterCol
              title="Company"
              links={[
                { label: "About Ryan", href: "#about" },
                { label: "Contact", href: "#contact" },
              ]}
            />
            <FooterCol
              title="Reach us"
              links={[
                { label: "(978) 555-1234", href: "tel:+19785551234" },
                {
                  label: "hello@penneyconstructioninc.com",
                  href: "mailto:hello@penneyconstructioninc.com",
                },
              ]}
            />
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-white/5 pt-6 text-xs text-white/40 sm:flex-row sm:items-center">
          <div>© {new Date().getFullYear()} Penney Construction, Inc. All rights reserved.</div>
          <div>MA CS-XXXXXX · HIC-XXXXXX · Fully licensed &amp; insured</div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-widest text-white/50">{title}</div>
      <ul className="mt-4 space-y-3">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              className="text-sm text-white/70 transition-colors hover:text-amber-400"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

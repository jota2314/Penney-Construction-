import Image from "next/image";
import {
  ArrowRight,
  ClipboardList,
  Compass,
  Hammer,
  Handshake,
  MapPin,
  Phone,
  Mail,
  ShieldCheck,
  Award,
  Home as HomeIcon,
} from "lucide-react";
import { SiteNav } from "./site-nav";
import { ContactForm } from "./contact-form";

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

const PROJECTS: {
  title: string;
  town: string;
  scope: string;
  meta: string;
  accent: string;
}[] = [
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

const PROCESS = [
  {
    n: "01",
    icon: Compass,
    title: "Walkthrough",
    body: "We visit your home, listen to what you want, and talk honestly about scope, budget, and timeline.",
  },
  {
    n: "02",
    icon: ClipboardList,
    title: "Estimate",
    body: "A detailed, line-by-line proposal — no black boxes. You see exactly what each trade costs.",
  },
  {
    n: "03",
    icon: Hammer,
    title: "Build",
    body: "Your project runs with a dedicated PM, vetted subs, and a daily schedule you can actually follow.",
  },
  {
    n: "04",
    icon: Handshake,
    title: "Handoff",
    body: "Punch list, final walkthrough, warranty. We stand behind the work long after the invoice clears.",
  },
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

/* ----------  HERO ---------- */

function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-16">
      {/* Ambient backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1200px 600px at 75% 0%, rgba(217,119,6,0.18), transparent 60%)," +
            "radial-gradient(900px 500px at 15% 30%, rgba(234,88,12,0.12), transparent 60%)," +
            "linear-gradient(180deg, #0A0A0A 0%, #0F0F10 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="mx-auto max-w-7xl px-5 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28 lg:pt-36">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
          <span className="h-px w-8 bg-amber-400/60" />
          Residential General Contractor · Est. North Shore, MA
        </div>

        <h1 className="mt-8 max-w-5xl font-display text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-7xl lg:text-[88px]">
          Built right.
          <br />
          <span className="text-white/60">On the </span>
          <span className="relative inline-block">
            <span className="relative z-10 italic text-amber-400">North Shore</span>
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded-sm bg-amber-500/15 sm:h-4"
            />
          </span>
          <span className="text-white/60">.</span>
        </h1>

        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-white/70 sm:text-xl">
          Penney Construction builds kitchens, additions, and whole-home renovations for families
          north of Boston. Owner-led, meticulously scheduled, and finished the way you&apos;d build
          it yourself.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3 sm:gap-4">
          <a
            href="#contact"
            className="group inline-flex items-center gap-2 rounded-full bg-amber-500 px-7 py-4 text-base font-semibold text-neutral-950 shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-400 hover:shadow-amber-500/40"
          >
            Request a consultation
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="#work"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-7 py-4 text-base font-medium text-white/90 transition-colors hover:border-amber-400/60 hover:text-amber-400"
          >
            See our work
          </a>
        </div>

        {/* Stats strip */}
        <dl className="mt-20 grid max-w-3xl grid-cols-2 gap-x-10 gap-y-10 sm:grid-cols-4">
          <Stat value="20+" label="Years building" />
          <Stat value="150+" label="Homes finished" />
          <Stat value="1" label="Project per PM" />
          <Stat value="A+" label="BBB accredited" />
        </dl>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="font-display text-4xl font-semibold text-white sm:text-5xl">{value}</dt>
      <dd className="mt-2 text-sm text-white/50">{label}</dd>
    </div>
  );
}

/* ----------  TRUST STRIP ---------- */

function TrustStrip() {
  return (
    <section className="border-y border-white/5 bg-neutral-900/40">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-5 py-8 text-sm text-white/60 sm:grid-cols-3 sm:px-8">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-amber-400" />
          <span>
            <span className="text-white">MA Licensed &amp; Insured</span> · CS-XXXXXX · HIC-XXXXXX
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Award className="h-5 w-5 text-amber-400" />
          <span>
            <span className="text-white">Family-owned</span> · Owner on every job
          </span>
        </div>
        <div className="flex items-center gap-3">
          <MapPin className="h-5 w-5 text-amber-400" />
          <span>
            <span className="text-white">Serving Essex County</span> · and surrounding towns
          </span>
        </div>
      </div>
    </section>
  );
}

/* ----------  PROJECTS ---------- */

function Projects() {
  return (
    <section id="work" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow="Recent work"
          title="A portfolio built one home at a time."
          blurb="Every project is different. Every client is the only one we're building for that week."
        />

        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECTS.map((p, i) => (
            <article
              key={p.title}
              className="group relative overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 transition-all hover:-translate-y-1 hover:border-amber-400/30"
            >
              {/* Image placeholder — swap for real photo */}
              <div className="relative aspect-[4/5] w-full overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-br ${p.accent}`} />
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
                  <HomeIcon className="h-14 w-14 text-white/10 transition-transform duration-500 group-hover:scale-110 group-hover:text-amber-400/40" />
                </div>
                <div className="absolute left-4 top-4 rounded-full bg-neutral-950/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400 backdrop-blur-sm">
                  Project {String(i + 1).padStart(2, "0")}
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-400/80">
                  <MapPin className="h-3.5 w-3.5" />
                  {p.town}
                </div>
                <h3 className="mt-2 font-display text-2xl font-semibold text-white">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{p.scope}</p>
                <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
                  <span className="text-xs text-white/40">{p.meta}</span>
                  <span className="text-xs font-medium text-amber-400 opacity-0 transition-opacity group-hover:opacity-100">
                    Details →
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------  PROCESS ---------- */

function Process() {
  return (
    <section id="process" className="relative border-y border-white/5 bg-neutral-900/40 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow="How we work"
          title="Four steps. Zero surprises."
          blurb="From first handshake to final walkthrough, you always know what's next."
        />

        <div className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/5 sm:grid-cols-2 lg:grid-cols-4">
          {PROCESS.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.n} className="relative bg-neutral-950 p-8">
                <div className="flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20">
                    <Icon className="h-5 w-5 text-amber-400" />
                  </div>
                  <span className="font-display text-3xl font-semibold text-white/10">
                    {step.n}
                  </span>
                </div>
                <h3 className="mt-6 font-display text-xl font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{step.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ----------  CAPABILITIES ---------- */

function Capabilities() {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-16 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeader
              eyebrow="Capabilities"
              title="One crew, one standard."
              blurb="We run a tight list of trades we trust. Every job on the North Shore, every trade vetted by us."
              align="left"
            />
          </div>

          <div className="lg:col-span-7">
            <div className="flex flex-wrap gap-3">
              {CAPABILITIES.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 transition-colors hover:border-amber-400/40 hover:bg-amber-500/10 hover:text-amber-400"
                >
                  {c}
                </span>
              ))}
            </div>

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
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------  OWNER LETTER ---------- */

function OwnerLetter() {
  return (
    <section id="about" className="relative overflow-hidden border-y border-white/5 bg-neutral-900/40 py-24 sm:py-32">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(600px 300px at 20% 20%, rgba(217,119,6,0.15), transparent 60%)",
        }}
      />

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-20">
          <div className="lg:col-span-4">
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
                <div className="mb-3 h-16 w-16 rounded-full bg-white/5 ring-1 ring-white/15" />
                <div className="text-xs font-medium uppercase tracking-widest text-amber-400">
                  Ryan Penney
                </div>
                <div className="mt-1 text-xs text-white/50">Owner · General Contractor</div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
              A note from Ryan
            </div>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-white sm:text-5xl">
              &ldquo;Your home isn&apos;t a job site to me. It&apos;s where your kids wake up.&rdquo;
            </h2>
            <div className="mt-8 space-y-5 text-base leading-relaxed text-white/70 sm:text-lg">
              <p>
                I started Penney Construction because I wanted to build the way I&apos;d want
                someone building on my own house. That means a clean job site, honest numbers, and
                a real human answering the phone when something comes up.
              </p>
              <p>
                We work on the North Shore because it&apos;s home. I know the inspectors, the
                suppliers, the weather, and the quirks of a 19th-century Ipswich colonial. Every
                project gets my personal attention — not because I have to, but because that&apos;s
                the only way I know how to do this.
              </p>
              <p className="font-display italic text-white">— Ryan Penney, Owner</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------  CONTACT ---------- */

function ContactSection() {
  return (
    <section id="contact" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-16 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeader
              eyebrow="Start a project"
              title="Let's talk about your home."
              blurb="Tell us what you're dreaming up. We'll come by for a walkthrough — no pressure, no sales pitch."
              align="left"
            />

            <div className="mt-10 space-y-5">
              <ContactRow icon={Phone} label="Phone" value="(978) 555-1234" href="tel:+19785551234" />
              <ContactRow
                icon={Mail}
                label="Email"
                value="hello@penneyconstructioninc.com"
                href="mailto:hello@penneyconstructioninc.com"
              />
              <ContactRow
                icon={MapPin}
                label="Office"
                value="By appointment · North Shore, MA"
              />
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-neutral-900 to-neutral-950 p-6 sm:p-10">
              <ContactForm />
            </div>
          </div>
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20">
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

  return href ? (
    <a href={href} className={classes}>
      {inner}
    </a>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

/* ----------  FOOTER ---------- */

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
                { label: "hello@penneyconstructioninc.com", href: "mailto:hello@penneyconstructioninc.com" },
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

/* ----------  SHARED ---------- */

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
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-amber-400/90">
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

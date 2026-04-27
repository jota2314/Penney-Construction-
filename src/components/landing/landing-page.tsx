"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import "./landing.css";

const SERVICES = [
  {
    n: "01",
    title: "Kitchens",
    desc: "From a careful refresh to a full reorganization — cabinetry, lighting, finishes, the full pantry of choices.",
    icon: (
      <svg className="icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M6 24V42H42V24M6 24L12 8H36L42 24M6 24H42M16 16H32M18 30H30M18 36H30" />
      </svg>
    ),
  },
  {
    n: "02",
    title: "Baths",
    desc: "Primary suites, powder rooms, the works. Tile we set ourselves, glass we measure twice.",
    icon: (
      <svg className="icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M10 22H38V36C38 38 36 40 34 40H14C12 40 10 38 10 36V22ZM10 22V12C10 10 12 8 14 8H20M28 14H34M28 18H34" />
      </svg>
    ),
  },
  {
    n: "03",
    title: "Additions",
    desc: "Adding floors, wings, primary suites. We tie new structure into old without seams or surprises.",
    icon: (
      <svg className="icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M6 42V20L18 8L18 42M18 42H42V20L30 8L18 8M18 28H30M18 34H30" />
      </svg>
    ),
  },
  {
    n: "04",
    title: "Custom Homes",
    desc: "Ground-up builds, designed and built to last. Site selection through final landscape.",
    icon: (
      <svg className="icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M4 44L24 8L44 44M10 34H38M18 44V28H30V44" />
      </svg>
    ),
  },
];

const POSTCARDS = [
  { src: "/landing/kitchen-hero.png", place: "Marblehead Neck", year: "Spring '25", postmarkPlace: "Marblehead Neck", postmarkYear: "'25", filter: "saturate(0.92)" },
  { src: "/landing/bath-1.png", place: "Beverly Cove", year: "Bath Suite", postmarkPlace: "Beverly Cove", postmarkYear: "'25" },
  { src: "/landing/exterior-1.png", place: "Manchester", year: "Carriage House", postmarkPlace: "Manchester", postmarkYear: "'24" },
  { src: "/landing/kitchen-hero.png", place: "Hingham Harbor", year: "Whole Home", postmarkPlace: "Hingham", postmarkYear: "'24", filter: "saturate(0.88) hue-rotate(-6deg)" },
  { src: "/landing/bath-1.png", place: "Cohasset", year: "Primary Suite", postmarkPlace: "Cohasset", postmarkYear: "'24", filter: "saturate(0.95) brightness(1.04)" },
  { src: "/landing/exterior-1.png", place: "Salem", year: "Shingle Addition", postmarkPlace: "Salem", postmarkYear: "'23", filter: "saturate(0.85) hue-rotate(8deg)" },
];

const TIMELINE = [
  { num: "i.", label: "Discovery", title: "The kitchen-table conversation.", body: "We sit at your table for an hour or two. We listen. We talk about how you actually live, what you've tried before, and what's been on the wish-list for ten years.", meta: ["Week 1", "· Site walk · Goals · Budget range"] },
  { num: "ii.", label: "Design", title: "Drawings made for building.", body: "Our team draws the project — plans, elevations, a few honest renderings. We choose finishes together. No 70-page spec books that nobody reads.", meta: ["Weeks 2 – 5", "· Concept · Selections · Permits"] },
  { num: "iii.", label: "Foundation", title: "Plans become permits.", body: "We finalize drawings, schedule subs, pour foundations. Your project moves from a folder onto the calendar — and out of the ground.", meta: ["Weeks 6 – 7", "· Permits · Excavation · Footings"] },
  { num: "iv.", label: "Framing", title: "Walls go up.", body: "Lumber, joists, headers, sheathing. The shape of your home appears overnight. Roof, windows, weather-tight by week's end.", meta: ["Weeks 8 – 11", "· Framing · Roof · Sheathing"] },
  { num: "v.", label: "Rough-in", title: "Skin and systems.", body: "Siding, then the bones inside — plumbing, electrical, HVAC. Inspections. Insulation. The unseen work that makes the seen work last.", meta: ["Weeks 11 – 15", "· MEP · Insulation · Inspections"] },
  { num: "vi.", label: "Finish", title: "Where it becomes a home.", body: "Drywall, trim, cabinets, tile, paint, lights, landscape. Every detail you'll touch every day. We walk through it together before we hand you the keys.", meta: ["Weeks 15 – 22", "· Finishes · Landscape · Walkthrough"] },
];

const NUMBERS = [
  { v: "Personal", l: "From first walk-through", desc: "We sit with you on site, in the space, before any number gets written down." },
  { v: "In-house", l: "Finish carpentry", desc: "Our trim, millwork, and built-ins are cut and hung by our own crew." },
  { v: "Bespoke", l: "Selections process", desc: "Finishes chosen with you, sample-by-sample — never from a vendor catalog." },
  { v: "Local", l: "North Shore only", desc: "Peabody-based. We work where we live, with subs we've known for years." },
];

const GALLERY = [
  { cls: "g-1", src: "/landing/kitchen-2.png", id: "PC-2026-046 · Marblehead", title: "Pedersen Kitchen & Addition", meta: "$557k · 14 weeks · Complete" },
  { cls: "g-2", src: "/landing/bath-2.png", id: "PC-2026-082 · Beverly Cove", title: "Cleary Master Bath", meta: "$48k · 6 weeks" },
  { cls: "g-3", src: "/landing/exterior-1.png", id: "PC-2026-094 · Manchester", title: "Gallegos Carriage House", meta: "$221k · 10 weeks" },
  { cls: "g-4", src: "/landing/exterior-3.png", id: "PC-2026-047 · Salem Willows", title: "Iler Full Remodel", meta: "$298k · 12 weeks" },
  { cls: "g-5", src: "/landing/exterior-2.png", id: "PC-2026-006 · Hamilton", title: "Conway Carriage House", meta: "In progress" },
];

type TeamMember = {
  badge: string;
  role: string;
  name: string;
  italName: string;
  tenure: string;
  bio: string;
  tags: string[];
  photo?: string;
  alt?: string;
  initial?: string;
};

const TEAM: TeamMember[] = [
  { badge: "Owner", role: "Owner · Principal", name: "Ryan", italName: "Penney", tenure: "Owner · runs the shop and walks every job", bio: "Sets the standard, signs every contract, and walks every site at least once. The buck — and the level — stops with him.", tags: ["Strategy", "Client Relations", "Quality Standard"], photo: "/landing/team-ryan.png", alt: "Ryan Penney" },
  { badge: "Numbers", role: "Pre-Construction · Estimator", name: "Jorge", italName: "Betancur", tenure: "Reads drawings the way most read the paper", bio: "Builds the budget line by line, runs takeoffs and sub pricing, and tells you what something will actually cost — not what you want it to.", tags: ["Estimating", "Take-offs", "Bid Leveling"], photo: "/landing/team-jorge.png", alt: "Jorge Betancur" },
  { badge: "Field", role: "Field · Lead Carpenter", name: "Howie", italName: "Clickstein", tenure: "Runs the jobsite · sets the bar with the first cut", bio: "If something doesn't look right, it's not. He'll have already fixed it before lunch and shown the apprentice why. The standard, in person.", tags: ["Framing", "Finish", "Crew Lead"], initial: "H" },
  { badge: "Office", role: "Admin · Permits & Deposits", name: "Nicole", italName: "Smith", tenure: "Keeps the office, the permits, and the deposits straight", bio: "Pulls every permit, tracks every deposit, and keeps every vendor paid on the day they're supposed to be. The reason calls get returned the same afternoon.", tags: ["Permits", "Deposits", "Vendors"], initial: "N" },
  { badge: "Intake", role: "Client Intake", name: "Shannon", italName: "Penney", tenure: "First voice on every new project", bio: "Handles first calls, gets the walkthrough on the calendar, and makes sure no one hires us without knowing exactly what we do. The front door of the shop.", tags: ["Intake", "Walkthroughs", "Client Care"], initial: "S" },
];

const FAQS = [
  { q: "How does the design-build process actually work?", a: "You hire one team for design and construction, instead of an architect and a builder separately. We draw, we estimate, we build. Decisions move faster, and there's no gap where the drawings hand off to a stranger.", open: true },
  { q: "What does a typical project cost?", a: "Bath renovations start around $40k. Kitchens around $80k. Additions and full remodels typically run $250k–$700k. Custom builds vary too widely to quote here — but we'll give you a real range, in writing, before you commit to anything." },
  { q: "How long from first call to keys?", a: "Two to four weeks from first conversation to a signed proposal. From there, a typical kitchen runs 8–10 weeks; a full remodel 12–16; a custom home 9–14 months. We hold those numbers honest with weekly updates you can actually read." },
  { q: "Do you handle permits and inspections?", a: "Always. Every permit, every inspection, every utility coordination. You see the result; we deal with the office." },
  { q: "What's your warranty?", a: "One year on all workmanship. Manufacturer warranties pass through on materials. And we still answer the phone in year five." },
  { q: "Where do you build?", a: "The North Shore: Peabody, Marblehead, Beverly, Manchester-by-the-Sea, Salem, Hamilton, Ipswich, Gloucester, Rockport — and the towns between. Outside that radius? Ask. We've made exceptions for the right project." },
];

export function LandingPage() {
  return (
    <div className="penney-landing grain" id="top">
      <Nav />
      <Hero />
      <Marquee />
      <Services />
      <Process />
      <Numbers />
      <Projects />
      <Team />
      <Testimonials />
      <FAQ />
      <ServiceArea />
      <Contact />
      <Footer />
      <RevealAndScroll />
    </div>
  );
}

/* ─── Reveal + nav-scroll observer ─── */
function RevealAndScroll() {
  useEffect(() => {
    const nav = document.getElementById("pl-nav");
    const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.12, rootMargin: "0px 0px -80px 0px" }
    );
    document.querySelectorAll(".penney-landing .reveal").forEach((el) => io.observe(el));
    return () => {
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
    };
  }, []);
  return null;
}

/* ─── Nav ─── */
function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="nav-wrap">
      <div className="nav-utility">
        <div className="group">
          <a href="tel:+19785551234" aria-label="Call Penney Construction">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            (978) 555-1234
          </a>
          <span className="item hide-mob">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            By appointment · North Shore, MA
          </span>
        </div>
        <div className="group">
          <span className="pill hide-mob">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Licensed &amp; Insured
          </span>
          <a href="/login" className="pill signin-pill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            Sign in
          </a>
        </div>
      </div>

      <nav className="nav" id="pl-nav">
        <a className="brand" href="#top" onClick={closeMenu} aria-label="Penney Construction">
          <div className="brand-mark">
            <Image src="/logo.jpg" alt="Penney Construction" width={224} height={140} priority />
          </div>
        </a>
        <div className={`nav-links ${menuOpen ? "open" : ""}`}>
          <a href="#services" onClick={closeMenu}>Services</a>
          <a href="#process" onClick={closeMenu}>Process</a>
          <a href="#projects" onClick={closeMenu}>Work</a>
          <a href="#team" onClick={closeMenu}>About</a>
          <a href="#faq" onClick={closeMenu}>FAQ</a>
          <a href="/login" className="mobile-signin" onClick={closeMenu}>Sign in →</a>
        </div>
        <div className="nav-right">
          <a className="cta-btn" href="#contact" onClick={closeMenu}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="cta-label">Call Now</span>
          </a>
          <button
            className="nav-toggle"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className={`burger ${menuOpen ? "open" : ""}`}>
              <span /><span /><span />
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}

/* ─── Hero ─── */
function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-corners">
        <span className="crn tl" />
        <span className="crn tr" />
      </div>
      <div className="hero-inner">
        <div>
          <div className="hero-eyebrow">
            <span className="rule" />
            <span>✦</span>
            <span>Family-run · North Shore, MA</span>
            <span>✦</span>
          </div>
          <h1>
            <span className="word" style={{ animationDelay: "0.4s" }}>Craftsmanship</span>{" "}
            <span className="word italic" style={{ animationDelay: "0.6s" }}>in&nbsp;the</span>
            <br />
            <span className="word italic" style={{ animationDelay: "0.8s" }}>finishes.</span>
          </h1>
          <p className="hero-sub">
            Penney Construction is a family-run design-build remodeler on Boston&apos;s North
            Shore. We&apos;re at our best in the millwork, the tile lines, the hardware reveals
            — and in giving every client a build that feels personal from first walkthrough to
            final punch.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary" href="#contact">
              Begin a project <span className="arr">→</span>
            </a>
            <a className="btn btn-ghost" href="#projects">
              Tour our work <span className="arr">→</span>
            </a>
          </div>
          <div className="hero-meta">
            <div className="stat"><span className="v">Personal</span><span className="l">Walk-throughs &amp; selections</span></div>
            <div className="stat"><span className="v">In-house</span><span className="l">Finish carpentry &amp; tile</span></div>
            <div className="stat"><span className="v">North Shore</span><span className="l">Peabody-based, locally built</span></div>
          </div>
        </div>
        <div className="hero-photo">
          <div className="frame">
            <Image src="/landing/kitchen-hero.png" alt="A bright airy kitchen by Penney Construction" width={520} height={780} sizes="(max-width: 1040px) 90vw, 540px" />
            <div className="caption">
              The Pedersen Kitchen
              <small>Marblehead Neck · Spring &apos;25</small>
            </div>
          </div>
          <div className="stamp">
            <div>
              <strong>Made</strong>by hand
              <br />
              <span className="italic">north shore</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Marquee ─── */
function Marquee() {
  const items = ["Kitchens", "Baths", "Additions", "Custom Homes", "Carriage Houses", "Outdoor Living", "Restorations"];
  const loop = [...items, ...items];
  return (
    <section className="marquee-wrap" aria-label="What we build">
      <div className="marquee">
        {loop.map((it, i) => (
          <span key={`${it}-${i}`} style={{ display: "contents" }}>
            <span className="marquee-item">{it}</span>
            <span className="marquee-star">✦</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/* ─── Services ─── */
function Services() {
  return (
    <section className="section" id="services">
      <div className="container">
        <div className="section-head reveal">
          <div>
            <div className="section-num"><span className="rule" />I · Services</div>
            <h2>What we<br /><span className="italic" style={{ color: "var(--copper)" }}>build.</span></h2>
          </div>
          <p className="lead">Four practices, one shop. We design, draw, and build under one roof — so the lines between vision, drawing, and execution stay short.</p>
        </div>
        <div className="services">
          {SERVICES.map((s) => (
            <article key={s.n} className="service reveal">
              <span className="num">№ {s.n}</span>
              {s.icon}
              <h3>{s.title}</h3>
              <p className="desc">{s.desc}</p>
              <span className="arrow">
                Explore
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><path d="M5 12H19M13 6L19 12L13 18" /></svg>
              </span>
            </article>
          ))}
        </div>
        <PostcardCarousel />
      </div>
    </section>
  );
}

/* ─── Postcard carousel ─── */
function PostcardCarousel() {
  const [cur, setCur] = useState(0);
  const N = POSTCARDS.length;
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const slot = (idx: number) => {
    let off = idx - cur;
    if (off > N / 2) off -= N;
    if (off < -N / 2) off += N;
    return Math.max(-2, Math.min(2, off));
  };

  const start = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setCur((c) => (c + 1) % N), 4200);
  };
  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const vio = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? start() : stop()));
    }, { threshold: 0.2 });
    vio.observe(root);
    return () => {
      vio.disconnect();
      stop();
    };
  }, [N]);

  return (
    <div className="postcard-carousel" ref={rootRef} onMouseEnter={stop} onMouseLeave={start}>
      <div className="feature-strip">
        {POSTCARDS.map((p, i) => (
          <div key={i} className="feature-photo" data-slot={slot(i)}>
            <div className="img-area">
              <img src={p.src} alt={p.place} style={{ objectFit: "cover", filter: p.filter }} />
            </div>
            <div className="postmark">
              <span className="ring" />
              {p.postmarkPlace}
              <span className="yr">{p.postmarkYear}</span>
            </div>
            <div className="caption">
              <span className="place">{p.place}</span>
              <span className="yr">{p.year}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="postcard-controls">
        <button className="pc-btn" onClick={() => setCur((c) => (c - 1 + N) % N)} aria-label="Previous photo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="pc-dots">
          {POSTCARDS.map((_, i) => (
            <button key={i} className={`pc-dot ${i === cur ? "active" : ""}`} onClick={() => setCur(i)} aria-label={`Photo ${i + 1}`} />
          ))}
        </div>
        <button className="pc-btn" onClick={() => setCur((c) => (c + 1) % N)} aria-label="Next photo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
    </div>
  );
}

/* ─── Process timeline ─── */
function Process() {
  return (
    <section className="section deep" id="process">
      <div className="container">
        <div className="section-head reveal">
          <div>
            <div className="section-num">
              <span className="rule" style={{ background: "var(--copper)" }} />
              II · Process
            </div>
            <h2>Six phases.<br /><span className="italic" style={{ color: "var(--copper)" }}>No surprises.</span></h2>
          </div>
          <p className="lead" style={{ color: "rgba(247, 241, 230, 0.78)" }}>
            Every project moves through the same six phases — so you always know where your build stands and what comes next. The shop has used the same checklist for forty years. It still fits on one page.
          </p>
        </div>
        <div className="timeline">
          {TIMELINE.map((row) => (
            <div key={row.num} className="timeline-row reveal">
              <span className="num">{row.num}</span>
              <div className="body">
                <div>
                  <div className="label">{row.label}</div>
                  <h3>{row.title}</h3>
                </div>
                <div>
                  <p>{row.body}</p>
                  <div className="meta">
                    {row.meta.map((m, i) => <span key={i}>{m}</span>)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Numbers ─── */
function Numbers() {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head reveal">
          <div>
            <div className="section-num"><span className="rule" />III · How we work</div>
            <h2>The finish<br /><span className="italic" style={{ color: "var(--copper)" }}>is the work.</span></h2>
          </div>
          <p className="lead">
            We don&apos;t compete on volume or speed. We compete on the half-inch reveal, the hardwood that lines up across rooms, the tile cut that disappears into the trim. And on giving you a build that feels like yours.
          </p>
        </div>
        <div className="numbers reveal">
          {NUMBERS.map((n) => (
            <div key={n.l} className="number">
              <div className="v">{n.v}</div>
              <div className="l">{n.l}</div>
              <div className="desc">{n.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Projects gallery ─── */
function Projects() {
  return (
    <section className="section tan" id="projects">
      <div className="container">
        <div className="section-head reveal">
          <div>
            <div className="section-num"><span className="rule" />IV · Selected work</div>
            <h2>Recent<br /><span className="italic" style={{ color: "var(--copper)" }}>builds.</span></h2>
          </div>
          <p className="lead">A curated selection from the last twelve months, from full kitchens to carriage houses on the water.</p>
        </div>
        <div className="gallery">
          {GALLERY.map((g) => (
            <a key={g.title} className={`gallery-card ${g.cls} reveal`} href="#">
              <div className="visual">
                <img src={g.src} alt={g.title} style={{ objectFit: "cover" }} />
              </div>
              <div className="info">
                <span className="pcc-id">{g.id}</span>
                <h3>{g.title}</h3>
                <span className="meta">{g.meta}</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Team coverflow ─── */
function Team() {
  const [cur, setCur] = useState(0);
  const N = TEAM.length;
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const slotOf = (idx: number) => {
    let off = idx - cur;
    if (off > N / 2) off -= N;
    if (off < -N / 2) off += N;
    return Math.max(-3, Math.min(3, off));
  };

  const start = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setCur((c) => (c + 1) % N), 5000);
  };
  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const vio = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? start() : stop()));
    }, { threshold: 0.2 });
    vio.observe(root);
    return () => {
      vio.disconnect();
      stop();
    };
  }, [N]);

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <section className="section" id="team">
      <div className="container">
        <div className="section-head reveal">
          <div>
            <div className="section-num"><span className="rule" />V · Team</div>
            <h2>Who<br /><span className="italic" style={{ color: "var(--copper)" }}>builds.</span></h2>
          </div>
          <p className="lead">Twelve full-time, ten years average tenure. The same hands you meet on day one are on the saw on closeout day.</p>
        </div>
        <div
          className="team-carousel"
          ref={rootRef}
          tabIndex={0}
          onMouseEnter={stop}
          onMouseLeave={start}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setCur((c) => (c - 1 + N) % N);
            if (e.key === "ArrowRight") setCur((c) => (c + 1) % N);
          }}
        >
          <div className="team-stage">
            {TEAM.map((m, i) => {
              const slot = slotOf(i);
              return (
                <article
                  key={m.name}
                  className="team-card"
                  data-slot={slot}
                  onClick={() => slot !== 0 && setCur(i)}
                >
                  <div className={`team-photo ${m.photo ? "has-photo" : ""}`}>
                    <span className="badge">{m.badge}</span>
                    {m.photo ? (
                      <img className="real-photo" src={m.photo} alt={m.alt ?? m.name} />
                    ) : (
                      <>
                        <svg className="silhouette" viewBox="0 0 100 120">
                          <circle cx="50" cy="36" r="19" fill="currentColor" />
                          <path d="M14 112 C 14 82, 30 72, 50 72 C 70 72, 86 82, 86 112 Z" fill="currentColor" />
                        </svg>
                        <span className="initial">{m.initial}</span>
                      </>
                    )}
                  </div>
                  <div className="team-body">
                    <div className="team-role">{m.role}</div>
                    <h3 className="team-name">{m.name} <span className="ital">{m.italName}</span></h3>
                    <div className="team-tenure">{m.tenure}</div>
                    <p className="team-bio">{m.bio}</p>
                    <div className="team-tags">
                      {m.tags.map((t) => <span key={t} className="team-tag">{t}</span>)}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="team-controls">
            <button className="tc-btn" onClick={() => setCur((c) => (c - 1 + N) % N)} aria-label="Previous teammate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <div className="tc-counter">
              {pad(cur + 1)}<span className="total"> / {pad(N)}</span>
            </div>
            <button className="tc-btn" onClick={() => setCur((c) => (c + 1) % N)} aria-label="Next teammate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Testimonials ─── */
function Testimonials() {
  return (
    <section className="section tan">
      <div className="container">
        <div className="section-head reveal">
          <div>
            <div className="section-num"><span className="rule" />VI · From clients</div>
            <h2>The work<br /><span className="italic" style={{ color: "var(--copper)" }}>speaks.</span></h2>
          </div>
          <p className="lead">A few notes from people who have lived through a Penney project — the dust, the decisions, and the mornings after.</p>
        </div>
        <div className="testi-grid">
          <div className="testi reveal">
            <div className="quote">They did everything they said they would, when they said they would, for the price they said they would. After two prior remodels, that was the part that surprised us.</div>
            <div className="by">
              <div className="ava">CL</div>
              <div className="who">Carla &amp; Liam Pedersen<small>Marblehead Neck · Whole-house addition</small></div>
            </div>
          </div>
          <div className="testi reveal">
            <div className="quote">They sat at our kitchen table for three hours before we ever talked numbers. That&apos;s why we hired them. That&apos;s why we&apos;d hire them again.</div>
            <div className="by">
              <div className="ava">M</div>
              <div className="who">Margot Cleary<small>Beverly Cove · Primary suite</small></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ ─── */
function FAQ() {
  return (
    <section className="section" id="faq">
      <div className="container">
        <div className="section-head reveal">
          <div>
            <div className="section-num"><span className="rule" />VII · Questions</div>
            <h2>Frequent<br /><span className="italic" style={{ color: "var(--copper)" }}>asks.</span></h2>
          </div>
          <p className="lead">A few that come up early. If something isn&apos;t here, write us — we&apos;ll answer it the same day.</p>
        </div>
        <div className="faq-list">
          {FAQS.map((f) => (
            <details key={f.q} className="faq reveal" open={f.open}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Service area ─── */
function ServiceArea() {
  const towns: { name: string; featured?: boolean }[] = [
    { name: "Peabody", featured: true }, { name: "Marblehead" },
    { name: "Manchester-by-the-Sea", featured: true }, { name: "Salem" },
    { name: "Swampscott" }, { name: "Hamilton" },
    { name: "Ipswich" }, { name: "Gloucester" },
    { name: "Rockport" }, { name: "Essex" },
    { name: "Wenham" }, { name: "Topsfield" },
  ];
  const pins = [
    { left: "56%", top: "52%", label: "Peabody · Shop", featured: true },
    { left: "50%", top: "44%", label: "Beverly" },
    { left: "60%", top: "36%", label: "Manchester" },
    { left: "46%", top: "52%", label: "Salem" },
    { left: "65%", top: "26%", label: "Gloucester" },
    { left: "50%", top: "30%", label: "Hamilton" },
  ];
  return (
    <section className="section tan">
      <div className="container area">
        <div className="reveal">
          <div className="section-num"><span className="rule" />VIII · Service area</div>
          <h2 style={{ margin: "16px 0 24px" }}>
            Boston&apos;s<br /><span className="italic" style={{ color: "var(--copper)" }}>North Shore.</span>
          </h2>
          <p className="lead">We work within a comfortable radius of our shop in Peabody. Close enough to be on a site in twenty minutes — far enough to find work worth the drive.</p>
          <ul className="area-list">
            {towns.map((t) => <li key={t.name} className={t.featured ? "f" : ""}>{t.name}</li>)}
          </ul>
        </div>
        <div className="area-map reveal">
          <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="pl-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="10" cy="10" r="0.6" fill="rgba(31, 42, 48, 0.18)" />
              </pattern>
              <radialGradient id="pl-hot">
                <stop offset="0%" stopColor="rgba(168, 127, 58, 0.22)" />
                <stop offset="100%" stopColor="rgba(168, 127, 58, 0)" />
              </radialGradient>
            </defs>
            <rect width="400" height="300" fill="url(#pl-grid)" />
            <ellipse cx="220" cy="160" rx="160" ry="100" fill="url(#pl-hot)" />
            <path d="M310 0 Q 280 60 300 100 Q 330 140 310 180 Q 280 220 320 260 Q 350 290 360 300 L400 300 L400 0 Z" fill="rgba(44, 70, 96, 0.10)" stroke="rgba(31, 42, 48, 0.20)" />
            <path d="M180 280 Q 200 240 240 250 Q 270 260 290 240" fill="none" stroke="rgba(31, 42, 48, 0.15)" />
            <g stroke="rgba(31, 42, 48, 0.12)" strokeWidth="0.7" fill="none">
              <path d="M0 150 Q 100 130 200 150 T 360 150" />
              <path d="M180 0 Q 170 100 200 150 T 240 300" />
              <path d="M50 220 Q 150 180 240 200 T 360 220" />
            </g>
            <g transform="translate(50, 50)" stroke="rgba(31, 42, 48, 0.4)" strokeWidth="0.6" fill="none">
              <circle r="18" />
              <path d="M0 -16 L0 16 M -16 0 L 16 0" />
              <path d="M0 -16 L4 0 L0 16 L-4 0 Z" fill="rgba(168,127,58,0.5)" stroke="none" />
              <text y="-22" textAnchor="middle" fontFamily="Playfair Display" fontStyle="italic" fontSize="10" fill="rgba(31,42,48,0.5)">N</text>
            </g>
          </svg>
          {pins.map((p) => (
            <div key={p.label} className="area-pin" style={{ left: p.left, top: p.top }}>
              <div className={`dot ${p.featured ? "featured" : ""}`} />
              <div className="label gar-italic">{p.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Contact ─── */
function Contact() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <section className="section" id="contact">
      <div className="container contact-inner">
        <div className="reveal">
          <div className="section-num"><span className="rule" />IX · Begin a project</div>
          <h2 style={{ marginTop: 16 }}>
            Tell us<br /><span className="italic" style={{ color: "var(--copper)" }}>about it.</span>
          </h2>
          <p className="lead">A few details and we&apos;ll get back to you within one business day. No pressure, no slick sales — just a real conversation about what you&apos;re picturing.</p>
          <div className="contact-info">
            <div className="row"><span className="l">Office</span><span className="v">By appointment · North Shore, MA</span></div>
            <div className="row"><span className="l">Direct</span><span className="v"><a href="tel:+19785551234">(978) 555-1234</a></span></div>
            <div className="row"><span className="l">Email</span><span className="v"><a href="mailto:hello@penneyconstructioninc.com">hello@penneyconstructioninc.com</a></span></div>
            <div className="row"><span className="l">Hours</span><span className="v">Mon – Fri · 7:00 – 5:30</span></div>
          </div>
        </div>
        <form
          className="form reveal"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          <div className="form-row">
            <div className="field"><label>Your name</label><input type="text" placeholder="Jenny Martinez" required /></div>
            <div className="field"><label>Email</label><input type="email" placeholder="you@email.com" required /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Phone</label><input type="tel" placeholder="(555) 555-1234" /></div>
            <div className="field">
              <label>Project type</label>
              <select>
                <option>Kitchen remodel</option>
                <option>Bath remodel</option>
                <option>Addition</option>
                <option>Full remodel</option>
                <option>Custom home</option>
                <option>Other</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Tell us about your project</label>
            <textarea placeholder="What you're picturing — and a rough range if you have one." />
          </div>
          <button type="submit" className="form-submit">
            {submitted ? "Sent · we'll be in touch" : "Send it over →"}
          </button>
        </form>
      </div>
    </section>
  );
}

/* ─── Footer ─── */
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <div className="brand-mark" style={{ display: "inline-flex" }}>
            <Image src="/logo.jpg" alt="Penney Construction logo" width={52} height={52} />
          </div>
          <div className="name">Penney Construction</div>
          <div className="tag">Craftsmanship in the finishes. A personal experience, every build. Family-run on Boston&apos;s North Shore.</div>
        </div>
        <div>
          <div className="head">Build</div>
          <ul>
            <li><a href="#services">Kitchens</a></li>
            <li><a href="#services">Baths</a></li>
            <li><a href="#services">Additions</a></li>
            <li><a href="#services">Custom Homes</a></li>
          </ul>
        </div>
        <div>
          <div className="head">Company</div>
          <ul>
            <li><a href="#process">Process</a></li>
            <li><a href="#team">Team</a></li>
            <li><a href="#projects">Work</a></li>
            <li><a href="#faq">FAQ</a></li>
          </ul>
        </div>
        <div>
          <div className="head">Get in touch</div>
          <ul>
            <li><a href="tel:+19785551234">(978) 555-1234</a></li>
            <li><a href="mailto:hello@penneyconstructioninc.com">hello@penneyconstructioninc.com</a></li>
            <li><a href="#contact">Begin a project</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-bot">
        <span>© Penney Construction, Inc. · MA HIC #142998</span>
        <span>Built with care.</span>
      </div>
    </footer>
  );
}

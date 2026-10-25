import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Penney Construction",
  description:
    "How Penney Construction collects, uses, and protects information from clients and visitors.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <Link
          href="/"
          className="text-sm text-amber-600 hover:underline dark:text-amber-400"
        >
          ← Back to home
        </Link>

        <h1 className="mt-6 text-4xl font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Last updated: April 26, 2026
        </p>

        <div className="prose prose-neutral dark:prose-invert mt-10 space-y-8">
          <section>
            <h2 className="text-xl font-semibold">Who we are</h2>
            <p>
              Penney Construction, Inc. (&ldquo;Penney Construction,&rdquo;
              &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a Massachusetts residential
              general contractor. This policy explains how we handle information
              we receive through{" "}
              <span className="font-medium">penneyconstruction.build</span> and
              when working with clients.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Information we collect</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Contact information</strong> — name, email, phone, and
                project address you submit through our contact form or share
                during a project.
              </li>
              <li>
                <strong>Project information</strong> — drawings, photos,
                budgets, schedules, vendor quotes, and invoices needed to
                estimate and build your project.
              </li>
              <li>
                <strong>Account &amp; authentication data</strong> — when our
                team signs in with Google Workspace, we receive basic profile
                information (name, email, profile photo) and tokens to access
                Gmail, Google Drive, and Google Calendar on their behalf.
              </li>
              <li>
                <strong>Usage data</strong> — basic logs from our hosting
                provider (Vercel) and database (Supabase) for security and
                debugging.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">How we use information</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>To respond to inquiries and prepare estimates and proposals.</li>
              <li>
                To manage active construction projects: scheduling, sub
                coordination, invoicing, and communication.
              </li>
              <li>
                To operate our internal management tools (email triage, project
                tracking, document storage).
              </li>
              <li>To meet legal, tax, and licensing obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Google user data</h2>
            <p>
              Our internal application uses Google APIs (Gmail, Drive,
              Calendar, Docs, Sheets) so Penney Construction staff can read and
              send project email, store project files, and schedule
              walkthroughs. Google account data is used only to provide these
              features for the signed-in employee. We do not sell or share
              Google user data with third parties, and we do not use it for
              advertising.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">How we share information</h2>
            <p>
              We do not sell personal information. We share information only
              with:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Subcontractors and vendors</strong> directly involved in
                your project (e.g., trade quotes, scheduling).
              </li>
              <li>
                <strong>Service providers</strong> who help us operate the
                business (Google Workspace, Supabase, Vercel, QuickBooks,
                Anthropic).
              </li>
              <li>
                <strong>Authorities</strong> when required by law (permits,
                inspections, tax reporting).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Data retention</h2>
            <p>
              We keep client and project records for as long as needed to
              complete the project and to satisfy legal, accounting, and
              warranty obligations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Your choices</h2>
            <p>
              You can request a copy of the information we hold about you, ask
              us to correct it, or ask us to delete it (subject to records we
              are legally required to keep). Contact us at the email below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Contact</h2>
            <p>
              Penney Construction, Inc.
              <br />
              North Shore, Massachusetts
              <br />
              Email:{" "}
              <a
                href="mailto:rpenney@penneyconstructioninc.com"
                className="text-amber-600 hover:underline dark:text-amber-400"
              >
                rpenney@penneyconstructioninc.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Penney Construction",
  description:
    "Terms governing use of the Penney Construction website and online tools.",
};

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Last updated: April 26, 2026
        </p>

        <div className="prose prose-neutral dark:prose-invert mt-10 space-y-8">
          <section>
            <h2 className="text-xl font-semibold">1. Who these terms cover</h2>
            <p>
              These terms govern your use of the Penney Construction website at{" "}
              <span className="font-medium">penneyconstruction.build</span> and
              any internal tools we provide to clients, employees, and
              subcontractors. By using the site or these tools you agree to
              these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">2. About Penney Construction</h2>
            <p>
              Penney Construction, Inc. is a licensed Massachusetts residential
              general contractor based on the North Shore. Construction services
              are governed by separate written contracts signed for each
              project.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">3. Account access</h2>
            <p>
              The internal application is restricted to Penney Construction
              employees signing in with their{" "}
              <span className="font-medium">@penneyconstructioninc.com</span>{" "}
              Google Workspace account. You are responsible for keeping your
              account credentials secure and for activity carried out under your
              account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">4. Acceptable use</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Do not use the site or tools to break the law, infringe rights,
                or harm others.
              </li>
              <li>
                Do not attempt to access accounts, data, or systems you have not
                been authorized to access.
              </li>
              <li>
                Do not interfere with the operation of the site, including by
                scraping, reverse engineering, or attempting to bypass security.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">5. Information you submit</h2>
            <p>
              When you submit information through the contact form, email, or
              project portal, you confirm that the information is accurate and
              that you have the right to share it. We handle this information
              under our{" "}
              <Link
                href="/privacy"
                className="text-amber-600 hover:underline dark:text-amber-400"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">
              6. Project contracts control
            </h2>
            <p>
              Anything you see on this site — including project examples,
              service descriptions, and pricing references — is informational.
              Actual scope, schedule, price, warranty, and obligations are
              defined only in a signed construction contract between Penney
              Construction and the client.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">7. Third-party services</h2>
            <p>
              Our internal tools rely on third-party services including Google
              Workspace, Supabase, Vercel, QuickBooks, and Anthropic. Use of
              those services through our application is also subject to their
              respective terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">8. No warranty</h2>
            <p>
              The site and internal tools are provided &ldquo;as is&rdquo;
              without warranty of any kind. We do not guarantee that the site
              will be uninterrupted, error-free, or always available. Nothing
              here limits any warranty Penney Construction provides under a
              signed construction contract.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">9. Limitation of liability</h2>
            <p>
              To the fullest extent permitted by law, Penney Construction is not
              liable for indirect, incidental, special, or consequential damages
              arising from your use of this site or the internal tools.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">10. Changes</h2>
            <p>
              We may update these terms from time to time. The &ldquo;Last
              updated&rdquo; date above will reflect the current version.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">11. Contact</h2>
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

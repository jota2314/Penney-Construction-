# Penney Construction App

**Application owner: Jorge Betancur.**

**Copyright © 2026 Jorge Betancur. All rights reserved.**

The Penney Construction application is owned by Jorge Betancur. It is the construction management platform used by Penney Construction, Inc. for estimating, project coordination, schedules, documents, invoicing, and client and subcontractor portals.

## Ownership and rights

The application software and original repository documentation are proprietary. See [LICENSE](LICENSE) for the rights notice and [NOTICE.md](NOTICE.md) for ownership, third-party attribution, and contact details.

Application ownership does not transfer ownership of Penney Construction's business, name, branding, customer records, financial information, or project materials. Third-party software and assets remain subject to their own licenses and notices. Existing written agreements remain in effect.

For application ownership and permissions, contact **Jorge Betancur** at [jbetancur@penneyconstructioninc.com](mailto:jbetancur@penneyconstructioninc.com).

## Development

The app uses Next.js, React, and TypeScript, with Tailwind CSS and Supabase. Install the dependencies:

```bash
npm ci
```

Configure the environment variables for your authorized development environment in `.env.local`. Keep credentials out of Git.

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000). Application routes live in `src/app`; shared components and supporting code live in `src/components` and `src/lib`.

```bash
npm run lint
npm run build
```

## Supporting documentation

- [App architecture and working guidance](CLAUDE.md)
- [iOS app icons and splash screens](resources/README.md)
- [Chat evaluation harness](scripts/chat-eval/README.md)
- [Terms of Service source](src/app/terms/page.tsx)
- [Privacy Policy source](src/app/privacy/page.tsx)

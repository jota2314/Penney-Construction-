# Invited Google sign-in

Crew members use the existing Team/Crew Admin invitation and `/login`. They must
choose the invited Google email. Normal login requests identity only; office
Gmail, Drive and Calendar connections use the authenticated reconnect action.

For a subcontractor, open **Subcontractors → Sub portal**, enter their Gmail or
Google Workspace email, and choose **Enable Google login**. Then use the existing
Email, Text or Copy invitation flow. Email and Copy do not need a phone or PIN.
No directory email is automatically granted access. A Google account can belong
to one subcontractor portal. Existing phone/PIN sign-in remains available.

Subcontractor Google login verifies Google's ID token on the server and issues
only a portal session, not a Supabase staff session. The first sign-in binds the
invitation to Google's stable subject. Every request checks that binding, the
invited email and enabled access. Changing the Google email invalidates previous
Google sessions without rotating the existing PIN salt. Turning portal access
off blocks both sign-in methods.

## Deployment and verification

Apply `20261104134735_sub_portal_google_login.sql` before deploying the app. It
adds nullable invitation/binding columns and unique indexes; it does not grant
access to any person or change existing permissions.

Google Identity Services uses the existing `GOOGLE_CLIENT_ID`,
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, or `app_settings.google_client_id`. In that OAuth
client's Google Cloud configuration, the authorized JavaScript origin must
include `https://www.penneyconstruction.build`. No new callback URL or Google
mailbox permissions are needed for the subcontractor button. If testing locally,
register that local origin separately. Google accounts backed by third-party
mailboxes without Gmail/Workspace ownership verification use the PIN option.

Run:

```text
node --test scripts/google-sign-in.test.cjs scripts/sub-google-auth.test.mjs scripts/sub-google-invites.test.cjs scripts/sub-google-qr.test.cjs
npx tsc --noEmit
npm run build
```

After deployment, an invited person should complete a real Google sign-in at
`/sub`, then from a job QR sign-in page. Automated tests verify signed tokens,
CSRF, invitations, revocation, account changes, PIN compatibility, office
connection handling and QR readiness; they do not impersonate a real Google
account or verify Google Cloud's authorized-origin configuration.

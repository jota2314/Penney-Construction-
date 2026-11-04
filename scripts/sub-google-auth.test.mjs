import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const jose = await import(pathToFileURL(require.resolve('jose')).href);

// Compile the real TypeScript and inject only its network/framework boundaries.
// No browser, Google requests, database writes or real credentials are used.
function load(relative, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (name) => name in dependencies ? dependencies[name] : name === 'jose' ? jose : require(name),
    module,
    module.exports,
  );
  return module.exports;
}

const identity = load('../src/lib/sub-portal/google-identity.ts');
const session = load('../src/lib/sub-portal/google-session.ts');
const clientId = 'test-client.apps.googleusercontent.com';
const nonce = 'one-time-browser-challenge';
const subject = 'google-subject-123';
const email = 'invited@gmail.com';
const accessId = '11111111-1111-4111-8111-111111111111';
const subId = '22222222-2222-4222-8222-222222222222';
const pinToken = '33333333-3333-4333-8333-333333333333';
const origin = 'https://www.penneyconstruction.build';
const keyPair = await jose.generateKeyPair('RS256');
const otherPair = await jose.generateKeyPair('RS256');
const now = Math.floor(Date.now() / 1000);
const signingSecret = 'test-only-sub-portal-secret-never-a-live-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = signingSecret;
process.env.GOOGLE_CLIENT_ID = clientId;

async function googleToken(overrides = {}, privateKey = keyPair.privateKey) {
  return new jose.SignJWT({
    sub: subject, email, email_verified: true, nonce,
    iss: 'https://accounts.google.com', aud: clientId, iat: now, exp: now + 300,
    ...overrides,
  }).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
}

test('Google identity: verifies signature, normalizes invited Gmail and accepts Workspace', async () => {
  assert.deepEqual(await identity.verifySubGoogleIdentity(
    await googleToken({ email: ' INVITED@GMAIL.COM ' }), clientId, nonce, async () => keyPair.publicKey,
  ), { subject, email });
  assert.deepEqual(await identity.verifySubGoogleIdentity(
    await googleToken({ email: 'person@trade.example', hd: 'trade.example', iss: 'accounts.google.com' }),
    clientId, nonce, async () => keyPair.publicKey,
  ), { subject, email: 'person@trade.example' });
});

test('Google identity: rejects invalid signature, audience, issuer, expiration and old assertions', async () => {
  for (const [label, overrides] of [
    ['audience', { aud: 'another-app' }],
    ['issuer', { iss: 'https://attacker.example' }],
    ['expired', { exp: now - 60 }],
    ['too old', { iat: now - 900, exp: now + 60 }],
    ['future issued', { iat: now + 300 }],
  ]) {
    await assert.rejects(identity.verifySubGoogleIdentity(
      await googleToken(overrides), clientId, nonce, async () => keyPair.publicKey,
    ), label);
  }
  await assert.rejects(identity.verifySubGoogleIdentity(
    await googleToken({}, otherPair.privateKey), clientId, nonce, async () => keyPair.publicKey,
  ));
});

test('Google identity: rejects nonce mismatch, unverified and third-party mailbox accounts', async () => {
  for (const overrides of [
    { nonce: 'another-browser' }, { nonce: undefined }, { email_verified: false },
    { email_verified: 'true' }, { sub: '' }, { email: 'person@third-party.example' },
    { email: 'person@third-party.example', hd: '' },
  ]) {
    await assert.rejects(identity.verifySubGoogleIdentity(
      await googleToken(overrides), clientId, nonce, async () => keyPair.publicKey,
    ));
  }
  await assert.rejects(identity.verifySubGoogleIdentity(
    await googleToken(), clientId, '', async () => keyPair.publicKey,
  ));
});

test('Google session: signed round trip, tamper rejection and wrong-purpose rejection', async () => {
  const expected = { accessId, subject, email };
  const signed = await session.createSubGoogleSession(expected);
  assert.ok(signed.startsWith('g1.'));
  assert.deepEqual(await session.readSubGoogleSession(signed), expected);
  const parts = signed.split('.');
  const payload = JSON.parse(Buffer.from(parts[2], 'base64url'));
  parts[2] = Buffer.from(JSON.stringify({ ...payload, access_id: subId })).toString('base64url');
  assert.equal(await session.readSubGoogleSession(parts.join('.')), null);
  assert.equal(await session.readSubGoogleSession(pinToken), null);
  assert.equal(await session.readSubGoogleSession('g1.not-a-token'), null);
});

test('Google session: rejects expired tokens and a token for another audience', async () => {
  const signingKey = createHash('sha256').update(`penney-sub-google-session-v1:${signingSecret}`).digest();
  for (const overrides of [{ exp: now - 1 }, { aud: 'staff-app' }]) {
    const signed = await new jose.SignJWT({
      sub: subject, access_id: accessId, email, iss: 'penney-sub-google', aud: 'sub-portal',
      iat: now - 10, exp: now + 100, ...overrides,
    }).setProtectedHeader({ alg: 'HS256' }).sign(signingKey);
    assert.equal(await session.readSubGoogleSession(`g1.${signed}`), null);
  }
});

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = new Headers(init.headers);
    this.cookieValues = new Map();
    this.cookies = { set: (name, value, options) => this.cookieValues.set(name, { value, options }) };
  }
  static json(body, init) { return new FakeResponse(body, init); }
}

function request({ credential = 'mock-google-credential', nonceValue = nonce, requestOrigin = origin,
  fetchSite = 'same-origin', cookie = null, staff = false, invalidJson = false } = {}) {
  const values = new Map();
  if (nonceValue) values.set('sub_google_nonce', { value: nonceValue });
  if (cookie) values.set('sub_portal_session', { value: cookie });
  return {
    nextUrl: new URL(`${origin}/api/sub-portal/google`),
    headers: new Headers({ ...(requestOrigin ? { origin: requestOrigin } : {}), 'sec-fetch-site': fetchSite }),
    cookies: { get: (name) => values.get(name), getAll: () => [...values].map(([name, item]) => ({ name, ...item })) },
    json: async () => { if (invalidJson) throw new Error('bad json'); return { credential }; },
    staff,
  };
}

function database(initialAccess, options = {}) {
  let access = initialAccess ? { ...initialAccess } : null;
  const queries = [];
  const client = {
    from(table) {
      const filters = [];
      let update = null;
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push([key, value]); return query; },
        is: (key, value) => { filters.push([key, value]); return query; },
        update: (values) => { update = values; return query; },
        maybeSingle: async () => perform(),
        then: (resolve, reject) => Promise.resolve(perform()).then(resolve, reject),
      };
      function perform() {
        queries.push({ table, filters, update });
        if (table === 'app_settings') return { data: { value: clientId }, error: null };
        if (table === 'subcontractors') return { data: { company_name: 'Invited trade', contact_name: 'Invited', trades: ['plumbing'] }, error: null };
        assert.equal(table, 'sub_portal_access');
        if (update && options.beforeClaim) options.beforeClaim(access);
        const match = access && filters.every(([key, value]) => access[key] === value);
        if (match && update) Object.assign(access, update);
        return { data: match ? { ...access } : null, error: null };
      }
      return query;
    },
  };
  return { client, queries, current: () => access, replace: (value) => { access = value; } };
}

function accessRow(overrides = {}) {
  return {
    id: accessId, subcontractor_id: subId, enabled: true, google_email: email,
    google_subject: null, token: pinToken, last_viewed_at: null, view_count: 0, ...overrides,
  };
}

function routeHarness(row = accessRow(), options = {}) {
  const db = database(row, options);
  let verifications = 0;
  const routes = load('../src/app/api/sub-portal/google/route.ts', {
    'next/server': { NextResponse: FakeResponse },
    '@/lib/supabase/admin': { createAdminClient: () => db.client },
    '@/lib/sub-portal/auth': {
      setSubPortalCookie: (response, value) => response.cookies.set('sub_portal_session', value, { httpOnly: true }),
    },
    '@/lib/sub-portal/google-identity': {
      verifySubGoogleIdentity: async (value, actualClient, actualNonce) => {
        verifications += 1;
        assert.equal(actualClient, clientId);
        assert.equal(actualNonce, nonce);
        if (options.invalidIdentity) throw new Error('Invalid identity');
        assert.equal(value, 'mock-google-credential');
        return { subject, email };
      },
    },
    '@/lib/sub-portal/google-session': session,
    '@/lib/sub-portal/staff-guard': {
      refuseStaffBrowser: async (req) => req.staff ? FakeResponse.json({ error: 'Staff browser' }, { status: 403 }) : null,
    },
  });
  return { ...db, ...routes, verifications: () => verifications };
}

test('Google endpoint: issues a private short-lived no-store nonce and refuses cross-site/staff initialization', async () => {
  const h = routeHarness();
  const response = await h.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.body.clientId, clientId);
  assert.ok(response.body.nonce.length >= 40);
  const challenge = response.cookieValues.get('sub_google_nonce');
  assert.equal(challenge.value, response.body.nonce);
  assert.equal(challenge.options.httpOnly, true);
  assert.equal(challenge.options.sameSite, 'strict');
  assert.equal(challenge.options.maxAge, 600);
  assert.equal((await h.GET(request({ fetchSite: 'cross-site' }))).status, 403);
  assert.equal((await h.GET(request({ staff: true }))).status, 403);
});

test('Google endpoint: CSRF, staff, missing nonce and malformed requests fail before identity or database access', async () => {
  for (const [opts, status] of [
    [{ requestOrigin: 'https://attacker.example' }, 403],
    [{ requestOrigin: null }, 403], [{ staff: true }, 403], [{ nonceValue: null }, 401],
    [{ invalidJson: true }, 400], [{ credential: 123 }, 400], [{ credential: 'x'.repeat(16385) }, 400],
  ]) {
    const h = routeHarness();
    assert.equal((await h.POST(request(opts))).status, status);
    assert.equal(h.verifications(), 0);
    assert.equal(h.queries.length, 0);
  }
});

test('Google endpoint: uninvited, disabled, different email and mismatched Google subject never get a session', async () => {
  for (const row of [null, accessRow({ enabled: false }), accessRow({ google_email: 'someone@gmail.com' }),
    accessRow({ google_subject: 'different-google-account' })]) {
    const h = routeHarness(row);
    const response = await h.POST(request());
    assert.equal(response.status, 403);
    assert.equal(response.cookieValues.has('sub_portal_session'), false);
    assert.equal(h.queries.some((q) => q.update), false);
  }
  const h = routeHarness(accessRow(), { invalidIdentity: true });
  assert.equal((await h.POST(request())).status, 401);
  assert.equal(h.queries.length, 0);
});

test('Google endpoint: first sign-in claims only an unbound invitation and creates a scoped session', async () => {
  const h = routeHarness();
  const response = await h.POST(request());
  assert.equal(response.status, 200);
  assert.equal(h.current().google_subject, subject);
  const claim = h.queries.find((q) => q.update);
  assert.ok(claim.filters.some(([key, value]) => key === 'google_subject' && value === null));
  assert.ok(claim.filters.some(([key, value]) => key === 'google_email' && value === email));
  assert.ok(claim.filters.some(([key, value]) => key === 'enabled' && value === true));
  const signed = response.cookieValues.get('sub_portal_session').value;
  assert.notEqual(signed, pinToken);
  assert.deepEqual(await session.readSubGoogleSession(signed), { accessId, subject, email });
  assert.equal(response.cookieValues.get('sub_google_nonce').options.maxAge, 0);
  assert.equal(h.queries.some((q) => ['profiles', 'allowed_emails', 'auth.users'].includes(q.table)), false);
});

test('Google endpoint: a previously bound account signs in without replacing its identity', async () => {
  const h = routeHarness(accessRow({ google_subject: subject }));
  assert.equal((await h.POST(request())).status, 200);
  assert.equal(h.queries.some((q) => q.update), false);
});

test('Google endpoint: concurrent revocation, email reassignment or competing identity fails closed', async () => {
  for (const changes of [
    { enabled: false }, { google_email: 'replacement@gmail.com' }, { google_subject: 'competing-subject' },
  ]) {
    const h = routeHarness(accessRow(), { beforeClaim: (row) => Object.assign(row, changes) });
    const response = await h.POST(request());
    assert.equal(response.status, 403);
    assert.equal(response.cookieValues.has('sub_portal_session'), false);
  }
});

test('Portal resolver: Google sessions require current subject/email/enabled; PIN access remains compatible', async () => {
  const signed = await session.createSubGoogleSession({ accessId, subject, email });
  const db = database(accessRow({ google_subject: subject }));
  const resolver = load('../src/lib/sub-portal/access.ts', {
    '@/lib/sub-portal/auth': { SUB_PORTAL_COOKIE: 'sub_portal_session', getSubPortalClient: () => db.client },
    '@/lib/sub-portal/google-session': session,
    '@/lib/sub-portal/statuses': { SUB_AGREEMENT_AWAITING_SIGN: [], SUB_AWARDED_QUOTE_STATUSES: [] },
  });
  assert.equal((await resolver.resolveSubAccessResult(request({ cookie: signed }))).ok, true);
  db.replace(accessRow({ google_subject: subject, enabled: false }));
  assert.equal((await resolver.resolveSubAccessResult(request({ cookie: signed }))).status, 403);
  for (const changes of [{ google_subject: null }, { google_subject: 'replacement' }, { google_email: 'replacement@gmail.com' }]) {
    db.replace(accessRow({ google_subject: subject, ...changes }));
    assert.equal((await resolver.resolveSubAccessResult(request({ cookie: signed }))).status, 401);
  }
  db.replace(accessRow());
  assert.equal((await resolver.resolveSubAccessResult(request({ cookie: pinToken }))).ok, true);
  assert.equal((await resolver.resolveSubAccessResult(request({ cookie: 'g1.invalid' }))).status, 401);
});

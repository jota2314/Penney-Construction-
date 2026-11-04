const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");
const ts = require("typescript");

function load(file, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, URL, console,
    process: { env: { NODE_ENV: "production" } },
    require(name) {
      if (!(name in imports)) throw new Error(`Unmocked import: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

const APP = "https://app.penneyconstructioninc.com";
const OFFICE = { id: "office-user", email: "office@example.com" };
const GOOGLE_URL = "https://accounts.google.com/oauth";
const AUTH_COOKIE = "sb-testproject-auth-token.0";

function harness(options = {}) {
  const settings = {
    user: OFFICE,
    role: "owner",
    connectUser: null,
    providerToken: "new-access-token",
    providerRefreshToken: "new-refresh-token",
    storedRefreshToken: null,
    oauthError: false,
    exchangeError: false,
    profileError: false,
    signOutThrows: false,
    signOutError: false,
    ...options,
  };
  const state = { oauth: [], exchanges: [], updates: [], selects: [], signOuts: [], cookies: new Map() };
  const incoming = new Map([
    ["google-access-token", "previous-account-access"],
    ["google-refresh-token", "previous-account-refresh"],
    [AUTH_COOKIE, "session-chunk"],
  ]);
  if (settings.connectUser) incoming.set("google-connect-user", settings.connectUser);
  const jar = {
    get: (name) => incoming.has(name) ? { value: incoming.get(name) } : undefined,
    getAll: () => [...incoming].map(([name, value]) => ({ name, value })),
    set: (name, value, options) => state.cookies.set(name, { value, ...options }),
    delete: (name) => state.cookies.set(name, { value: "", maxAge: 0 }),
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: settings.user }, error: null }),
      signInWithOAuth: async (input) => {
        state.oauth.push(input);
        return settings.oauthError
          ? { data: { url: null }, error: { message: "Provider unavailable" } }
          : { data: { url: GOOGLE_URL }, error: null };
      },
      exchangeCodeForSession: async (code) => {
        state.exchanges.push(code);
        return {
          data: { session: {
            user: settings.user,
            provider_token: settings.providerToken,
            provider_refresh_token: settings.providerRefreshToken,
          } },
          error: settings.exchangeError ? { message: "Invalid code" } : null,
        };
      },
      getUserIdentities: async () => ({ data: { identities: [{ provider: "google" }] }, error: null }),
      signOut: async (input) => {
        state.signOuts.push(input);
        if (settings.signOutThrows) throw new Error("Auth unavailable");
        return { error: settings.signOutError ? { message: "Auth unavailable" } : null };
      },
    },
    from(table) {
      // A role must never be reassigned from an old allowlist during login.
      assert.equal(table, "profiles");
      let selected;
      let update;
      return {
        select(columns) { selected = columns; state.selects.push(columns); return this; },
        update(values) { update = values; return this; },
        eq(column, id) {
          assert.equal(column, "id");
          assert.equal(id, settings.user.id);
          if (update) {
            state.updates.push({ id, ...update });
            return Promise.resolve({ error: null });
          }
          return this;
        },
        async single() {
          return settings.profileError ? { data: null, error: { message: "Unavailable" } } : {
            data: selected === "google_refresh_token"
              ? { google_refresh_token: settings.storedRefreshToken }
              : settings.role ? { role: settings.role } : null,
            error: null,
          };
        },
        async maybeSingle() { return this.single(); },
      };
    },
  };
  const shared = {
    "next/headers": { cookies: async () => jar, headers: async () => new Map([["host", new URL(APP).host]]) },
    "@/lib/supabase/server": { createClient: async () => client },
  };
  const actions = load("src/lib/auth/actions.ts", {
    ...shared,
    "next/navigation": { redirect(url) { const error = new Error("Redirect"); error.destination = url; throw error; } },
    "@/lib/sub-portal/auth": { SUB_PORTAL_COOKIE: "sub_portal_session", LEGACY_SUB_PORTAL_COOKIE: "sub_portal_token" },
  });
  const callback = load("src/app/(auth)/auth/callback/route.ts", {
    ...shared,
    "next/server": { NextResponse: { redirect(url) {
      const changes = new Map();
      return { url, changes, cookies: { set: (name, value, options) => changes.set(name, { value, ...options }) } };
    } } },
  });
  return {
    state, actions,
    callback: (query = "?code=oauth-code") => callback.GET(new Request(`${APP}/auth/callback${query}`)),
  };
}

function cleared(cookies, name) {
  assert.equal(cookies.get(name)?.value, "", `${name} value cleared`);
  assert.equal(cookies.get(name)?.maxAge, 0, `${name} expired`);
}

test("normal login requests identity only and clears any previous connection intent", async () => {
  const { actions, state } = harness({ connectUser: OFFICE.id });
  await assert.rejects(actions.signInWithGoogle(), (error) => error.destination === GOOGLE_URL);
  const options = state.oauth[0].options;
  assert.equal(options.scopes, undefined);
  assert.equal(options.queryParams.prompt, "select_account");
  assert.equal(options.queryParams.access_type, undefined);
  assert.equal(options.redirectTo, `${APP}/auth/callback`);
  cleared(state.cookies, "google-connect-user");
  assert.equal(state.cookies.get("google-connect-user").path, "/auth/callback");
});

test("login returns a readable provider-start failure", async () => {
  const { actions } = harness({ oauthError: true });
  assert.match((await actions.signInWithGoogle()).error, /Google sign-in couldn't start/);
});

test("field, missing, and unreadable profiles cannot request integration scopes", async () => {
  for (const options of [{ role: "field" }, { role: null }, { profileError: true }]) {
    const { actions, state } = harness(options);
    await assert.rejects(actions.reconnectGoogle(), /Only office team members/);
    assert.equal(state.oauth.length, 0);
    assert.equal(state.cookies.size, 0);
  }
});

test("unauthenticated reconnect returns to login before requesting Google scopes", async () => {
  const { actions, state } = harness({ user: null });
  await assert.rejects(actions.reconnectGoogle(), (error) => error.destination === "/login");
  assert.equal(state.oauth.length, 0);
});

test("office reconnect requests integration scopes and binds callback to the initiating user", async () => {
  for (const role of ["owner", "precon_manager", "project_manager", "office_admin"]) {
    const { actions, state } = harness({ role });
    await assert.rejects(actions.reconnectGoogle(), (error) => error.destination === GOOGLE_URL);
    const options = state.oauth[0].options;
    assert.ok(options.scopes.includes("/auth/gmail.send"));
    assert.equal(options.queryParams.prompt, "consent");
    assert.equal(options.queryParams.access_type, "offline");
    assert.equal(options.queryParams.login_hint, OFFICE.email);
    assert.equal(options.redirectTo, `${APP}/auth/callback`);
    const cookie = state.cookies.get("google-connect-user");
    assert.equal(cookie.value, OFFICE.id);
    assert.equal(cookie.path, "/auth/callback");
    assert.equal(cookie.maxAge, 600);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, "lax");
  }
});

test("failed reconnect does not leave a new connection intent", async () => {
  const { actions, state } = harness({ oauthError: true });
  await assert.rejects(actions.reconnectGoogle(), /Google connection couldn't start/);
  assert.equal(state.cookies.size, 0);
});

test("normal callback discards provider tokens and prior browser integration caches", async () => {
  const { callback, state } = harness();
  const response = await callback("?code=oauth-code&google_connect=1");
  assert.equal(response.url, `${APP}/command-center`);
  assert.equal(state.updates.length, 0);
  cleared(response.changes, "google-access-token");
  cleared(response.changes, "google-refresh-token");
  cleared(response.changes, "google-connect-user");
});

test("field callback always returns to Crew even when next requests an office page", async () => {
  const { callback, state } = harness({ role: "field" });
  const response = await callback("?code=oauth-code&next=/command-center");
  assert.equal(response.url, `${APP}/crew`);
  assert.equal(state.updates.length, 0);
});

test("callback preserves an administrator-assigned office role without allowlist synchronization", async () => {
  const { callback, state } = harness({ role: "office_admin" });
  assert.equal((await callback()).url, `${APP}/command-center`);
  assert.equal(state.updates.length, 0);
  assert.equal(state.selects.join(","), "role");
});

test("matching office callback saves only that user's new integration tokens", async () => {
  const { callback, state } = harness({ connectUser: OFFICE.id });
  const response = await callback();
  assert.equal(response.url, `${APP}/command-center`);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].id, OFFICE.id);
  assert.equal(state.updates[0].google_refresh_token, "new-refresh-token");
  assert.equal(response.changes.get("google-access-token").value, "new-access-token");
  assert.equal(response.changes.get("google-refresh-token").value, "new-refresh-token");
  cleared(response.changes, "google-connect-user");
});

test("office reconnect fallback restores only the current user's saved refresh token", async () => {
  const { callback, state } = harness({ connectUser: OFFICE.id, providerRefreshToken: null, storedRefreshToken: "own-saved-refresh" });
  const response = await callback();
  assert.equal(response.changes.get("google-refresh-token").value, "own-saved-refresh");
  assert.equal(state.updates.length, 0);
});

test("reconnect with no tokens does not retain a previous browser account's tokens", async () => {
  const { callback } = harness({ connectUser: OFFICE.id, providerToken: null, providerRefreshToken: null });
  const response = await callback();
  cleared(response.changes, "google-access-token");
  cleared(response.changes, "google-refresh-token");
});

test("mismatched, field, and unreadable reconnect identities fail closed", async () => {
  for (const options of [{ connectUser: "another-user" }, { connectUser: OFFICE.id, role: "field" }, { connectUser: OFFICE.id, profileError: true }]) {
    const { callback, state } = harness(options);
    const response = await callback();
    assert.equal(response.url, `${APP}/login?error=integration_account_mismatch`);
    assert.equal(state.updates.length, 0);
    assert.equal(state.signOuts[0].scope, "local");
    for (const name of [AUTH_COOKIE, "google-connect-user", "google-access-token", "google-refresh-token"]) cleared(response.changes, name);
  }
});

test("mismatched reconnect still clears local session if auth sign-out fails", async () => {
  for (const options of [{ signOutThrows: true }, { signOutError: true }]) {
    const { callback, state } = harness({ connectUser: "another-user", ...options });
    const response = await callback();
    assert.equal(response.url, `${APP}/login?error=integration_account_mismatch`);
    assert.equal(state.updates.length, 0);
    cleared(response.changes, AUTH_COOKIE);
  }
});

test("failed or missing authorization code clears pending intent and old integration caches", async () => {
  for (const [options, query] of [[{ exchangeError: true }, "?code=invalid"], [{}, "?error=access_denied"]]) {
    const { callback, state } = harness({ connectUser: OFFICE.id, ...options });
    const response = await callback(query);
    assert.equal(response.url, `${APP}/login?error=auth_callback_error`);
    assert.equal(state.updates.length, 0);
    for (const name of ["google-connect-user", "google-access-token", "google-refresh-token"]) cleared(response.changes, name);
  }
});

test("callback rejects external and backslash redirect targets", async () => {
  for (const next of ["https://other.example", "//other.example", "/\\other.example"]) {
    const { callback } = harness();
    assert.equal((await callback(`?code=oauth-code&next=${encodeURIComponent(next)}`)).url, `${APP}/command-center`);
  }
});

test("sign-out clears integration caches and pending connection alongside sub cookies", async () => {
  const { actions, state } = harness();
  await assert.rejects(actions.signOut(), (error) => error.destination === "/login");
  for (const name of ["sub_portal_session", "sub_portal_token", "google-connect-user", "google-access-token", "google-refresh-token"]) cleared(state.cookies, name);
});

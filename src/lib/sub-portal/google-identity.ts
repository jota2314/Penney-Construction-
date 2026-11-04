import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Verify Google's signature and the browser's one-time login challenge. */
export async function verifySubGoogleIdentity(
  credential: string,
  clientId: string,
  nonce: string,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<{ subject: string; email: string }> {
  const { payload } = await jwtVerify(credential, keys, {
    algorithms: ["RS256"],
    audience: clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    requiredClaims: ["sub", "email", "email_verified", "nonce", "iat", "exp"],
    maxTokenAge: "10 minutes",
    clockTolerance: 10,
  });
  if (payload.nonce !== nonce || !nonce || payload.email_verified !== true ||
      typeof payload.email !== "string" || !payload.sub) {
    throw new Error("Invalid Google sign-in");
  }
  const email = payload.email.trim().toLowerCase();
  // Google is authoritative for Gmail and Workspace addresses. A Google
  // account using a third-party mailbox needs separate ownership verification.
  if (!email.endsWith("@gmail.com") && !(typeof payload.hd === "string" && payload.hd.trim())) {
    throw new Error("Use an invited Gmail or Google Workspace account, or sign in with your phone and PIN.");
  }
  return { subject: payload.sub, email };
}

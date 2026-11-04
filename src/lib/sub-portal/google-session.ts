import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

const ISSUER = "penney-sub-google";
const AUDIENCE = "sub-portal";

function signingKey() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Portal session signing is unavailable");
  // Purpose-separated key. Never expose the service credential or a Google token.
  return createHash("sha256").update(`penney-sub-google-session-v1:${secret}`).digest();
}

export type SubGoogleSession = { accessId: string; subject: string; email: string };

export async function createSubGoogleSession(session: SubGoogleSession): Promise<string> {
  const jwt = await new SignJWT({ access_id: session.accessId, email: session.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.subject)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("60 days")
    .sign(signingKey());
  return `g1.${jwt}`;
}

export async function readSubGoogleSession(value: string): Promise<SubGoogleSession | null> {
  if (!value.startsWith("g1.")) return null;
  try {
    const { payload } = await jwtVerify(value.slice(3), signingKey(), {
      algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE,
      requiredClaims: ["sub", "access_id", "email", "iat", "exp"],
    });
    if (!payload.sub || typeof payload.access_id !== "string" || typeof payload.email !== "string") return null;
    return { accessId: payload.access_id, subject: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

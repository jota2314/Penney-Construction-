import { NextResponse } from "next/server";

interface ContactPayload {
  name?: string;
  email?: string;
  phone?: string;
  projectType?: string;
  town?: string;
  message?: string;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  let body: ContactPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const email = body.email?.trim();
  const message = body.message?.trim();

  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Please include your name." }, { status: 400 });
  }
  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: "Please include a valid email." }, { status: 400 });
  }
  if (!message || message.length < 10) {
    return NextResponse.json({ error: "Tell us a little about the project." }, { status: 400 });
  }

  const payload = {
    name,
    email,
    phone: body.phone?.trim() || null,
    projectType: body.projectType?.trim() || null,
    town: body.town?.trim() || null,
    message,
    receivedAt: new Date().toISOString(),
  };

  // TODO: wire up storage + email notification
  // Options: insert into Supabase `leads` with a public-insert RLS policy,
  // and send via Gmail/Resend to jbetancur@penneyconstructioninc.com.
  console.log("[contact] new inquiry", payload);

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleFetch } from "@/lib/google/auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const query = searchParams.get("q") || "in:inbox OR in:sent";

  try {
    // Fetch email IDs
    const listRes = await googleFetch(
      `${GMAIL_API}/users/me/messages?maxResults=${limit}&q=${encodeURIComponent(query)}`
    );
    if (!listRes.ok) throw new Error("Failed to list messages");
    const listData = await listRes.json();
    const messageIds: { id: string }[] = listData.messages || [];

    // Fetch metadata only (not full body) for each — much cheaper
    const metadataPromises = messageIds.map(async (m) => {
      const res = await googleFetch(
        `${GMAIL_API}/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
      );
      if (!res.ok) return null;
      const data = await res.json();

      const headers = data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: { name: string; value: string }) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

      return {
        id: data.id,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: getHeader("Date"),
        snippet: data.snippet || "",
      };
    });

    const results = await Promise.all(metadataPromises);
    const emails = results.filter(Boolean);

    return NextResponse.json({ emails });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

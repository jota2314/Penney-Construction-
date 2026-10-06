/**
 * Turn a stored email body (plain text OR raw HTML) into readable plain text
 * for AI prompts.
 *
 * gmail-sync stores whichever part Gmail gave us, and for HTML-only mail that
 * is the full document — <head>, <style> blocks, tracking pixels and all. The
 * classifier used to cut the RAW body at 1,500 characters, so on many emails
 * the model saw nothing but CSS. Strip first, then cut.
 */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) {
      const n = parseInt(lower.slice(2), 16);
      return Number.isFinite(n) ? safeFromCodePoint(n, whole) : whole;
    }
    if (lower.startsWith("#")) {
      const n = parseInt(lower.slice(1), 10);
      return Number.isFinite(n) ? safeFromCodePoint(n, whole) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

function safeFromCodePoint(n: number, fallback: string): string {
  // A lone surrogate (&#55357;) would make the API request invalid JSON.
  if (n >= 0xd800 && n <= 0xdfff) return "�";
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
}

/**
 * Replace unpaired UTF-16 surrogates with U+FFFD. JSON.stringify keeps them as
 * "\udXXX" escapes, which the Messages API rejects with a 400 — and cutting a
 * string at a fixed length can split an emoji and create one.
 */
export function toWellFormedText(text: string): string {
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "�");
}

const LOOKS_LIKE_HTML = /<(html|head|body|div|p|br|table|span|style|font|td)\b/i;
// Only the start of a body is ever used, and the tag regexes below get slow
// on garbled markup (thousands of unclosed "<"). Cap the work.
const MAX_INPUT_CHARS = 100_000;

export function emailBodyToText(body: string | null | undefined): string {
  if (!body) return "";

  let text = body.length > MAX_INPUT_CHARS ? body.slice(0, MAX_INPUT_CHARS) : body;
  if (LOOKS_LIKE_HTML.test(text)) {
    text = text
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(head|style|script|title|xml)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<\/t[dh]\s*>/gi, " ")
      // A real tag starts with a letter (or "/" + letter) and contains no "<";
      // "Price is < $5,000" survives, and a run of unclosed "<" stays linear.
      .replace(/<\/?[a-z][^<>]*>/gi, " ");
  }

  return toWellFormedText(
    decodeEntities(text)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

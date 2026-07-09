import DOMPurify from "dompurify";

const EMAIL_TAGS = [
  "p", "br", "div", "span", "a", "b", "strong", "i", "em", "u", "ul",
  "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr", "td",
  "th", "thead", "tbody", "img", "blockquote", "hr", "pre", "code", "font",
  "center",
];

const EMAIL_ATTRIBUTES = [
  "href", "target", "src", "alt", "width", "height", "style", "class",
  "colspan", "rowspan", "color", "size", "face",
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Formats plain-text email and sanitizes HTML email before DOM rendering. */
export function formatEmailBody(body: string): string {
  if (!body) return "<p>No content</p>";

  if (/<(div|p|br|table|html|head|body)\b/i.test(body)) {
    return DOMPurify.sanitize(body, {
      ALLOWED_TAGS: EMAIL_TAGS,
      ALLOWED_ATTR: EMAIL_ATTRIBUTES,
    });
  }

  const htmlParts: string[] = [];
  let inQuote = false;
  let quoteDepth = 0;

  for (const line of body.split("\n")) {
    const quoteMatch = line.match(/^(>[\s>]*)/);
    const depth = quoteMatch ? (quoteMatch[0].match(/>/g) || []).length : 0;

    if (depth > 0 && !inQuote) {
      inQuote = true;
      quoteDepth = depth;
      htmlParts.push('<div class="email-quote">');
    } else if (depth === 0 && inQuote) {
      inQuote = false;
      quoteDepth = 0;
      htmlParts.push("</div>");
    } else if (depth !== quoteDepth && inQuote) {
      htmlParts.push("</div>", '<div class="email-quote">');
      quoteDepth = depth;
    }

    const content = depth > 0 ? line.replace(/^[>\s]+/, "").trim() : line;

    if (/^On .+ wrote:$/.test(content) || /^On .+@.+ wrote:$/.test(content)) {
      htmlParts.push(`<p class="email-attribution">${escapeHtml(content)}</p>`);
    } else if (content.trim() === "") {
      htmlParts.push("<br>");
    } else {
      const linked = escapeHtml(content)
        .replace(
          /(https?:\/\/[^\s<]+)/g,
          '<a href="$1" target="_blank" rel="noopener">$1</a>'
        )
        .replace(
          /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
          '<a href="mailto:$1">$1</a>'
        );
      htmlParts.push(`<p>${linked}</p>`);
    }
  }

  if (inQuote) htmlParts.push("</div>");
  return htmlParts.join("\n");
}

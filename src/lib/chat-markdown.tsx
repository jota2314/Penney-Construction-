import { Fragment, type ReactNode } from "react";
import { FileText, ExternalLink } from "lucide-react";

/**
 * Inline markdown renderer for AI chat messages.
 *
 * Handles:
 * - [label](url) markdown links — tolerates whitespace/newlines between
 *   the ] and ( (the AI sometimes wraps them across lines)
 * - **bold**
 * - Bare URLs (for resilience — the AI sometimes forgets markdown)
 *
 * Links that look like files (PDF, storage URLs) render as file cards
 * instead of plain anchor tags — nicer click target, clearer intent.
 */
export function renderInlineMarkdown(text: string): ReactNode {
  // Normalize: collapse `] (` or `]\n(` to `](` so standard markdown
  // matches even when the AI broke the link across lines.
  const normalized = text.replace(/\]\s*\(/g, "](");

  const nodes: ReactNode[] = [];
  // [label](url) | **bold** | bare URL
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(normalized)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(<Fragment key={key++}>{normalized.slice(lastIndex, m.index)}</Fragment>);
    }
    if (m[1] && m[2]) {
      nodes.push(renderLink(m[1], m[2], key++));
    } else if (m[3]) {
      nodes.push(<strong key={key++}>{m[3]}</strong>);
    } else if (m[4]) {
      // Bare URL — use the last path segment (minus query) as the label
      const url = m[4];
      let label = url;
      try {
        const u = new URL(url);
        const seg = u.pathname.split("/").filter(Boolean).pop();
        if (seg) label = decodeURIComponent(seg);
      } catch { /* keep full url as label */ }
      nodes.push(renderLink(label, url, key++));
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < normalized.length) {
    nodes.push(<Fragment key={key++}>{normalized.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

function renderLink(label: string, url: string, key: number): ReactNode {
  const looksLikeFile =
    /\.(pdf|xlsx?|docx?|csv|png|jpe?g|webp|zip)$/i.test(label) ||
    /\.(pdf|xlsx?|docx?|csv|png|jpe?g|webp|zip)(?:\?|$)/i.test(url) ||
    /storage\/v1\/object/i.test(url);

  if (looksLikeFile) {
    return (
      <a
        key={key}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="not-italic my-1 inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-500/60 transition-colors px-2.5 py-1.5 text-[12.5px] font-medium text-amber-700 dark:text-amber-300 no-underline max-w-full"
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
      </a>
    );
  }

  return (
    <a
      key={key}
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-amber-600 dark:text-amber-400 underline underline-offset-2 hover:text-amber-500 break-all"
    >
      {label}
    </a>
  );
}

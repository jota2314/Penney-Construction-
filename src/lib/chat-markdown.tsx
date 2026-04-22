import { Fragment, type ReactNode } from "react";

/**
 * Minimal inline markdown renderer used across every AI chat surface.
 * Handles [label](url) links and **bold** — enough to make file links
 * clickable and titles emphasized without a full markdown library.
 */
export function renderInlineMarkdown(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(<Fragment key={key++}>{text.slice(lastIndex, m.index)}</Fragment>);
    }
    if (m[1] && m[2]) {
      nodes.push(
        <a
          key={key++}
          href={m[2]}
          target="_blank"
          rel="noreferrer"
          className="text-amber-600 dark:text-amber-400 underline underline-offset-2 hover:text-amber-500 break-all"
        >
          {m[1]}
        </a>
      );
    } else if (m[3]) {
      nodes.push(<strong key={key++}>{m[3]}</strong>);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

import { Fragment, type ReactNode } from "react";

/**
 * Tiny, safe-by-construction Markdown renderer for incident updates and descriptions.
 * Supports paragraphs, headings (##/###), bullet/numbered lists, **bold**, *italic*, `code`,
 * fenced code blocks, links and line breaks. Raw HTML is never emitted.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) { buf.push(lines[i]!); i++; }
      i++;
      out.push(<pre key={key++}><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1]!.length;
      const content = renderInline(h[2]!);
      out.push(level === 1 ? <h2 key={key++}>{content}</h2> : level === 2 ? <h3 key={key++}>{content}</h3> : <h4 key={key++}>{content}</h4>);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]!) || /^\s*\d+\.\s+/.test(lines[i]!))) {
        items.push(<li key={items.length}>{renderInline(lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>);
        i++;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|?\s*:?-{2,}/)) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) { rows.push(lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())); i++; }
      const [head, , ...body] = rows;
      out.push(
        <table key={key++}>
          <thead><tr>{head!.map((c, ci) => <th key={ci}>{renderInline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) { buf.push(lines[i]!.slice(2)); i++; }
      out.push(<blockquote key={key++}>{renderInline(buf.join(" "))}</blockquote>);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.startsWith("```") && !/^(#{1,3})\s/.test(lines[i]!) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!) && !lines[i]!.startsWith("> ") && !lines[i]!.startsWith("|")) { buf.push(lines[i]!); i++; }
    out.push(<p key={key++}>{buf.map((l, idx) => <Fragment key={idx}>{idx > 0 && <br />}{renderInline(l)}</Fragment>)}</p>);
  }
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<]+)/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("*")) nodes.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("`")) nodes.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      nodes.push(<a key={k++} href={m[2]} rel="noopener nofollow" target="_blank">{label}</a>);
    } else nodes.push(<a key={k++} href={tok} rel="noopener nofollow" target="_blank">{tok}</a>);
    last = idx + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

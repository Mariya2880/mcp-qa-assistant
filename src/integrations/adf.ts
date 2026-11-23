/**
 * A small Markdown → Atlassian Document Format (ADF) converter.
 *
 * Jira Cloud's REST API v3 only accepts rich text as ADF. It covers exactly the Markdown that
 * draftBugReport produces: headings, paragraphs, bullet and numbered lists, fenced code blocks,
 * and the inline marks **bold**, `code` and _italic_. Anything else is kept as plain text.
 */

type Mark = { type: 'strong' | 'code' | 'em' };
export interface AdfText {
  type: 'text';
  text: string;
  marks?: Mark[];
}
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<AdfNode | AdfText>;
}
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|(?<!\w)_[^_]+_(?!\w))/;

/** Splits a line into text nodes, turning Markdown emphasis into ADF marks. */
export function inline(line: string): AdfText[] {
  return line
    .split(INLINE)
    .filter((part) => part.length > 0)
    .map((part): AdfText => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return { type: 'text', text: part.slice(2, -2), marks: [{ type: 'strong' }] };
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return { type: 'text', text: part.slice(1, -1), marks: [{ type: 'code' }] };
      }
      if (/^_[^_]+_$/.test(part)) {
        return { type: 'text', text: part.slice(1, -1), marks: [{ type: 'em' }] };
      }
      return { type: 'text', text: part };
    });
}

const paragraph = (line: string): AdfNode => ({ type: 'paragraph', content: inline(line) });

export function markdownToAdf(markdown: string): AdfDoc {
  const lines = markdown.split('\n');
  const content: AdfNode[] = [];
  let list: AdfNode | undefined;

  const closeList = () => {
    if (list) content.push(list);
    list = undefined;
  };
  const addListItem = (type: 'bulletList' | 'orderedList', text: string) => {
    if (list?.type !== type) {
      closeList();
      list = { type, content: [] };
    }
    list.content!.push({ type: 'listItem', content: [paragraph(text)] });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const code: string[] = [];
      while (i + 1 < lines.length && !lines[i + 1]!.startsWith('```')) code.push(lines[++i]!);
      i++; // skip the closing fence
      const text = code.join('\n');
      content.push({
        type: 'codeBlock',
        ...(fence[1] ? { attrs: { language: fence[1] } } : {}),
        ...(text ? { content: [{ type: 'text', text }] } : {}),
      });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const summary = line.match(/<summary>(.*?)<\/summary>/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);

    if (heading) {
      closeList();
      content.push({ type: 'heading', attrs: { level: heading[1]!.length }, content: inline(heading[2]!) });
    } else if (summary) {
      // GitHub's collapsible <details> has no ADF equivalent: keep its summary as a heading.
      closeList();
      content.push({ type: 'heading', attrs: { level: 3 }, content: inline(summary[1]!) });
    } else if (/^\s*<\/?details>\s*$/.test(line)) {
      continue;
    } else if (bullet) {
      addListItem('bulletList', bullet[1]!);
    } else if (numbered) {
      addListItem('orderedList', numbered[1]!);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      content.push(paragraph(line.trim()));
    }
  }
  closeList();

  return { type: 'doc', version: 1, content };
}

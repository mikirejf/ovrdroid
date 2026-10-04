export interface Prefix {
  slice: string;
  rest: string;
}

export function prefixWithin(text: string, cells: number): Prefix {
  if (cells <= 0) {
    return { slice: '', rest: text };
  }
  let used = 0;
  let end = 0;
  for (const segment of text) {
    const width = Bun.stringWidth(segment);
    if (used + width > cells) {
      if (used === 0) {
        end = segment.length;
      }
      break;
    }
    used += width;
    end += segment.length;
  }
  return { slice: text.slice(0, end), rest: text.slice(end) };
}

export function endCut(text: string, cells: number): string {
  if (cells <= 0) {
    return '';
  }
  if (Bun.stringWidth(text) <= cells) {
    return text;
  }
  return `${prefixWithin(text, cells - 1).slice}\u2026`;
}

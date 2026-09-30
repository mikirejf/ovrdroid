export interface Token {
  kind: 'ident' | 'other';
  text: string;
}

export interface HolePattern {
  source: string;
  names: string[];
}

const MINIFIED_NAME_MAX = 3;

const SHORT_WORDS = new Set('let var for of in new try do if get set NaN Map Set'.split(' '));

const HOLE = '([A-Za-z_$][\\w$]*)';
const CHUNK_HOLE = '(chunk-[a-z0-9]+)';
const CHUNK_NAME = /chunk-[a-z0-9]{8}(?=\.js)/gu;
const QUOTES = new Set(['"', "'"]);
const DIVIDES_AFTER = /[\w$)\]]/u;
const SPACE = /\s/u;
const IDENT_START = /[a-z_$]/iu;
const IDENT_PART = /[\w$]/u;
const DIGIT = /\d/u;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu;

function escape(text: string): string {
  return text.replace(REGEX_SPECIAL, '\\$&');
}

function endOfString(text: string, at: number): number {
  const quote = text[at];
  let i = at + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    i += 1;
    if (ch === quote) {
      break;
    }
  }
  return i;
}

function endOfWord(text: string, at: number): number {
  let i = at;
  while (i < text.length && IDENT_PART.test(text[i] ?? '')) {
    i += 1;
  }
  return i;
}

function endOfRegex(text: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    i += 1;
    if (ch === '[') {
      inClass = true;
    } else if (ch === ']') {
      inClass = false;
    } else if (ch === '/' && !inClass) {
      break;
    }
  }
  return endOfWord(text, i);
}

function startsRegex(text: string, at: number): boolean {
  if (text[at + 1] === '*' || text[at + 1] === '/') {
    return false;
  }
  let before = at - 1;
  while (before >= 0 && SPACE.test(text[before] ?? '')) {
    before -= 1;
  }
  return before < 0 || !DIVIDES_AFTER.test(text[before] ?? '');
}

function isHole(text: string, start: number, word: string): boolean {
  if (word.length > MINIFIED_NAME_MAX || SHORT_WORDS.has(word)) {
    return false;
  }
  const before = text[start - 1];
  if (before === '.' && text.slice(start - 3, start) !== '...') {
    return false;
  }
  return !((before === '{' || before === ',') && text[start + word.length] === ':');
}

class Scanner {
  readonly tokens: Token[] = [];
  private other = '';
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  keep(text: string): void {
    this.other += text;
  }

  name(word: string): void {
    this.flush();
    this.tokens.push({ kind: 'ident', text: word });
  }

  flush(): void {
    if (this.other !== '') {
      this.tokens.push({ kind: 'other', text: this.other });
      this.other = '';
    }
  }

  code(from: number, closesOnBrace: boolean): number {
    const { text } = this;
    let i = from;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i] ?? '';
      if (ch === '`') {
        i = this.template(i);
      } else if (QUOTES.has(ch)) {
        i = this.quoted(i, endOfString(text, i));
      } else if (ch === '/' && startsRegex(text, i)) {
        i = this.verbatim(i, endOfRegex(text, i));
      } else if (DIGIT.test(ch)) {
        i = this.verbatim(i, endOfWord(text, i + 1));
      } else if (IDENT_START.test(ch)) {
        const end = endOfWord(text, i + 1);
        const word = text.slice(i, end);
        if (isHole(text, i, word)) {
          this.name(word);
        } else {
          this.keep(word);
        }
        i = end;
      } else {
        if (ch === '}' && closesOnBrace && depth === 0) {
          return i;
        }
        if (ch === '{') {
          depth += 1;
        } else if (ch === '}') {
          depth -= 1;
        }
        this.keep(ch);
        i += 1;
      }
    }
    return i;
  }

  private quoted(from: number, to: number): number {
    const literal = this.text.slice(from, to);
    let at = 0;
    for (const chunk of literal.matchAll(CHUNK_NAME)) {
      this.keep(literal.slice(at, chunk.index));
      this.name(chunk[0]);
      at = chunk.index + chunk[0].length;
    }
    this.keep(literal.slice(at));
    return to;
  }

  private verbatim(from: number, to: number): number {
    this.keep(this.text.slice(from, to));
    return to;
  }

  private template(at: number): number {
    const { text } = this;
    this.keep('`');
    let i = at + 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        i = this.verbatim(i, i + 2);
      } else if (ch === '`') {
        this.keep(ch);
        return i + 1;
      } else if (ch === '$' && text[i + 1] === '{') {
        this.keep('${');
        i = this.code(i + 2, true);
        if (i < text.length) {
          i = this.verbatim(i, i + 1);
        }
      } else {
        i = this.verbatim(i, i + 1);
      }
    }
    return i;
  }
}

export function tokenize(text: string): Token[] {
  const scanner = new Scanner(text);
  scanner.code(0, false);
  scanner.flush();
  return scanner.tokens;
}

export function holePattern(text: string, known: ReadonlyMap<string, string> = new Map()) {
  const names: string[] = [];
  let source = '';
  for (const token of tokenize(text)) {
    if (token.kind === 'other') {
      source += escape(token.text);
      continue;
    }
    const fixed = known.get(token.text);
    if (fixed !== undefined) {
      source += escape(fixed);
      continue;
    }
    const seen = names.indexOf(token.text);
    if (seen === -1) {
      names.push(token.text);
      source += token.text.startsWith('chunk-') ? CHUNK_HOLE : HOLE;
    } else {
      source += `\\${seen + 1}`;
    }
  }
  return { source, names } satisfies HolePattern;
}

export function renameIn(text: string, map: ReadonlyMap<string, string>): string {
  return tokenize(text)
    .map((token) => (token.kind === 'ident' ? (map.get(token.text) ?? token.text) : token.text))
    .join('');
}

export function freeNames(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((token) => token.kind === 'ident')
        .map((token) => token.text),
    ),
  ];
}

export function literalParts(text: string): string[] {
  return tokenize(text)
    .filter((token) => token.kind === 'other')
    .map((token) => token.text)
    .toSorted((a, b) => b.length - a.length);
}

const ESC = '\u001B';
const BEL = '\u0007';
const TAB_STOP = 8;
const BLANK = ' ';

interface Row {
  cells: string[];
  wrapped: boolean;
}

type Mode = 'ground' | 'escape' | 'csi' | 'osc' | 'oscEscape';

function blankRow(cols: number): Row {
  return { cells: Array.from({ length: cols }, () => BLANK), wrapped: false };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function paramsOf(text: string): number[] {
  return text
    .replace(/^[?>=<]/u, '')
    .split(';')
    .map((part) => Math.trunc(Number(part)));
}

export class TerminalScreen {
  private cols: number;
  private height: number;
  private rows: Row[];
  private scrollback: Row[] = [];
  private row = 0;
  private col = 0;
  private pendingWrap = false;
  private autowrap = true;
  private mode: Mode = 'ground';
  private sequence = '';

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.height = rows;
    this.rows = Array.from({ length: rows }, () => blankRow(cols));
  }

  resize(cols: number, rows: number): void {
    this.rows = Array.from({ length: rows }, (_, at) => {
      const old = this.rows[at];
      const cells = Array.from({ length: cols }, (__, cell) => old?.cells[cell] ?? BLANK);
      return { cells, wrapped: false };
    });
    this.cols = cols;
    this.height = rows;
    this.row = clamp(this.row, 0, rows - 1);
    this.col = clamp(this.col, 0, cols - 1);
    this.pendingWrap = false;
  }

  feed(text: string): void {
    for (const char of text) {
      this.take(char);
    }
  }

  lines(): string[] {
    const lines: string[] = [];
    let joining = false;
    for (const row of [...this.scrollback, ...this.rows]) {
      const text = row.cells.join('');
      const shown = row.wrapped ? text : text.trimEnd();
      if (joining) {
        lines[lines.length - 1] += shown;
      } else {
        lines.push(shown);
      }
      joining = row.wrapped;
    }
    while (lines.at(-1) === '') {
      lines.pop();
    }
    return lines;
  }

  private take(char: string): void {
    if (this.mode === 'ground') {
      this.ground(char);
    } else if (this.mode === 'escape') {
      this.afterEscape(char);
    } else if (this.mode === 'csi') {
      this.inSequence(char);
    } else {
      this.inString(char);
    }
  }

  private ground(char: string): void {
    if (char === ESC) {
      this.mode = 'escape';
    } else if (char === '\r') {
      this.col = 0;
      this.pendingWrap = false;
    } else if (char === '\n') {
      this.lineFeed();
    } else if (char === '\b') {
      this.col = Math.max(0, this.col - 1);
      this.pendingWrap = false;
    } else if (char === '\t') {
      this.col = Math.min(this.cols - 1, (Math.floor(this.col / TAB_STOP) + 1) * TAB_STOP);
      this.pendingWrap = false;
    } else if (char >= BLANK) {
      this.print(char);
    }
  }

  private afterEscape(char: string): void {
    this.sequence = '';
    if (char === '[') {
      this.mode = 'csi';
    } else if (char === ']') {
      this.mode = 'osc';
    } else {
      this.mode = 'ground';
    }
  }

  private inSequence(char: string): void {
    if (char >= '@' && char <= '~') {
      this.mode = 'ground';
      this.control(char, this.sequence);
    } else {
      this.sequence += char;
    }
  }

  private inString(char: string): void {
    if (this.mode === 'oscEscape') {
      this.mode = char === '\\' ? 'ground' : 'osc';
    } else if (char === BEL) {
      this.mode = 'ground';
    } else if (char === ESC) {
      this.mode = 'oscEscape';
    }
  }

  private lineFeed(): void {
    this.pendingWrap = false;
    if (this.row === this.height - 1) {
      const gone = this.rows.shift();
      if (gone !== undefined) {
        this.scrollback.push(gone);
      }
      this.rows.push(blankRow(this.cols));
    } else {
      this.row += 1;
    }
  }

  private print(char: string): void {
    const width = Bun.stringWidth(char);
    if (width === 0) {
      return;
    }
    if (this.pendingWrap || this.col + width > this.cols) {
      if (this.autowrap) {
        this.current().wrapped = true;
        this.col = 0;
        this.lineFeed();
      } else {
        this.col = this.cols - width;
      }
    }
    const row = this.current();
    row.cells[this.col] = char;
    if (width === 2) {
      row.cells[this.col + 1] = '';
    }
    this.col += width;
    if (this.col >= this.cols) {
      this.col = this.cols - 1;
      this.pendingWrap = true;
    }
  }

  private current(): Row {
    const row = this.rows[this.row];
    if (row === undefined) {
      throw new RangeError(`the cursor is on row ${this.row}, outside ${this.height} rows`);
    }
    return row;
  }

  private control(final: string, sequence: string): void {
    const [first = 0, second = 0] = paramsOf(sequence);
    const count = Math.max(1, first);
    if (final === 'h' || final === 'l') {
      if (sequence === '?7') {
        this.autowrap = final === 'h';
      }
      return;
    }
    this.pendingWrap = false;
    if (final === 'A') {
      this.row = Math.max(0, this.row - count);
    } else if (final === 'B') {
      this.row = Math.min(this.height - 1, this.row + count);
    } else if (final === 'C') {
      this.col = Math.min(this.cols - 1, this.col + count);
    } else if (final === 'D') {
      this.col = Math.max(0, this.col - count);
    } else if (final === 'E') {
      this.row = Math.min(this.height - 1, this.row + count);
      this.col = 0;
    } else if (final === 'G') {
      this.col = clamp(count - 1, 0, this.cols - 1);
    } else if (final === 'H' || final === 'f') {
      this.row = clamp(Math.max(1, first) - 1, 0, this.height - 1);
      this.col = clamp(Math.max(1, second) - 1, 0, this.cols - 1);
    } else if (final === 'J') {
      this.eraseDisplay(first);
    } else if (final === 'K') {
      this.eraseLine(first);
    }
  }

  private eraseLine(mode: number): void {
    const row = this.current();
    const from = mode === 0 ? this.col : 0;
    const to = mode === 1 ? this.col : this.cols - 1;
    for (let at = from; at <= to; at += 1) {
      row.cells[at] = BLANK;
    }
    row.wrapped = false;
  }

  private eraseDisplay(mode: number): void {
    if (mode === 3) {
      this.scrollback = [];
    } else if (mode === 2) {
      this.rows = Array.from({ length: this.height }, () => blankRow(this.cols));
    } else {
      const here = this.row;
      this.eraseLine(mode === 0 ? 0 : 1);
      const rest = mode === 0 ? this.rows.slice(here + 1) : this.rows.slice(0, here);
      for (const row of rest) {
        row.cells.fill(BLANK);
        row.wrapped = false;
      }
    }
  }
}

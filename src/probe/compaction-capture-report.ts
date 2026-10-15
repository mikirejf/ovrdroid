import { whole } from '../cli.ts';
import { isJsonObject, requestKind } from './compaction-fallback-report.ts';
import type { RequestKind } from './compaction-fallback-report.ts';
import type { Fields } from './fields.ts';
import { fieldsOf, fieldsOfJson, worded } from './fields.ts';

export interface CapturedRow {
  line: number;
  kind: RequestKind;
  model: string;
  messages: number;
  bytes: number;
}

function messageCount(body: Fields): number {
  const list = body.get('messages') ?? body.get('input');
  return Array.isArray(list) ? list.length : 0;
}

export function rowsFor(text: string, sessionId: string): CapturedRow[] {
  return text.split('\n').flatMap((raw, line) => {
    const fields = fieldsOfJson(raw);
    const body: unknown = fields.get('body');
    if (worded(fields, 'sessionId') !== sessionId || !isJsonObject(body)) {
      return [];
    }
    const own = fieldsOf(body);
    return [
      {
        line,
        kind: requestKind(body),
        model: worded(own, 'model'),
        messages: messageCount(own),
        bytes: Buffer.byteLength(raw),
      },
    ];
  });
}

export function reuseRows(rows: readonly CapturedRow[]): CapturedRow[] {
  return rows.filter((row) => row.kind === 'reuse');
}

export function missingReuse(rows: readonly CapturedRow[], sessionId: string): string {
  const seen =
    rows.length === 0
      ? 'none'
      : ['ordinary', 'stock', 'reuse']
          .map((kind) => `${rows.filter((row) => row.kind === kind).length} ${kind}`)
          .join(', ');
  return `the bodies file holds no reuse compaction row for session ${sessionId}, so the reuse path did not run; rows for this session: ${seen}. Is the binary a \`probe build --bodies\` build with the compaction-reuse patches, and did $OD_BODIES point at this file?`;
}

export function describeRow(row: CapturedRow, file: string): string {
  return `reuse compaction row at line ${row.line} (0-based) of ${file}: model ${row.model}, ${row.messages} messages, ${whole(row.bytes)} bytes`;
}

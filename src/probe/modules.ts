export interface ModuleCost {
  selfMs: number;
  body: string;
}

export interface ModuleReport {
  rows: ModuleCost[];
  totalMs: number;
  moduleCount: number;
  unlabelledMs: number;
  unlabelledCount: number;
}

export function parseModules(text: string): ModuleReport {
  const rows: ModuleCost[] = [];
  let totalMs = 0;
  let moduleCount = 0;
  let unlabelledMs = 0;
  let unlabelledCount = 0;

  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) {
      continue;
    }
    const selfMs = Number(line.slice(0, tab));
    if (Number.isNaN(selfMs)) {
      continue;
    }
    const body = line.slice(tab + 1);
    totalMs += selfMs;
    moduleCount += 1;
    if (body === '') {
      unlabelledMs += selfMs;
      unlabelledCount += 1;
    } else {
      rows.push({ selfMs, body });
    }
  }

  return {
    rows: rows.toSorted((a, b) => b.selfMs - a.selfMs),
    totalMs,
    moduleCount,
    unlabelledMs,
    unlabelledCount,
  };
}

export function formatModules(rows: readonly ModuleCost[], width: number): string {
  return rows
    .map((row) => `${row.selfMs.toFixed(1).padStart(8)}ms  ${row.body.slice(0, width)}`)
    .join('\n');
}

export interface CheckResult {
  name: string;
  passed: boolean;
  seconds: number;
  log: string;
}

export interface GateSummary {
  passed: boolean;
  lines: string[];
}

function whole(seconds: number): string {
  return seconds.toFixed(0);
}

export function describeResult(result: CheckResult): string {
  const { name, passed, seconds, log } = result;
  return passed ? `pass  ${name}  ${whole(seconds)}s` : `FAIL  ${name}  ${whole(seconds)}s  ${log}`;
}

export function summarise(results: readonly CheckResult[], wallSeconds: number): GateSummary {
  const failed = results.filter((result) => !result.passed);
  const lines = [
    `${results.length - failed.length} of ${results.length} checks passed in ${whole(wallSeconds)}s`,
  ];
  for (const result of failed) {
    lines.push(`failed: ${result.name}  ${result.log}`);
  }
  return { passed: results.length > 0 && failed.length === 0, lines };
}

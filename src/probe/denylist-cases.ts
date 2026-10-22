import { fieldsOf, fieldsOfJson, worded } from './fields.ts';

export const PROBE_DENYLIST: readonly string[] = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf $HOME',
  'halt',
  'init 6',
  'git push',
];

export const RULES_ENGINE_FLAG = 'cli_rules_engine';

export type Engine = 'legacy' | 'rules';
export type Outcome = 'asks' | 'runs';
export type Observed = Outcome | 'blocked' | 'not run';

export interface DenylistCase {
  what: string;
  command: string;
  engine: Engine;
  expect: Outcome;
}

export interface CasePaths {
  sandbox: string;
  absentHomeChild: string;
}

const ASKED = 'insufficient permission';
const BLOCKED = 'Dangerous command detected';
const NEVER_RUNS = 'false && ';
const BRACED_HOME = ['$', '{HOME}'].join('');

function asks(engine: Engine, what: string, command: string): DenylistCase {
  return { what, command: `${NEVER_RUNS}${command}`, engine, expect: 'asks' };
}

function runs(engine: Engine, what: string, command: string): DenylistCase {
  return { what, command, engine, expect: 'runs' };
}

function quotedHeredoc(file: string, body: string): string {
  return `cat > ${file} <<'EOF'\n${body}\nEOF\n`;
}

export function denylistCases({ sandbox, absentHomeChild }: CasePaths): DenylistCase[] {
  return [
    asks('legacy', 'rm -rf / still asks', 'rm -rf /'),
    asks('legacy', 'init 6 still asks as a whole command', 'init 6'),
    {
      what: 'a substitution in an unquoted heredoc body still asks',
      command: 'cat <<EOF\n$(false && halt)\nEOF\n',
      engine: 'legacy',
      expect: 'asks',
    },
    runs(
      'legacy',
      'a quoted heredoc body that mentions a deny entry is text',
      quotedHeredoc('note.md', 'see `init 6` in init.BS957yFf.js:276'),
    ),
    runs('legacy', 'a command that only starts with "init" runs', 'init.BS957yFf.js 6 || true'),
    asks('rules', 'a custom entry (git push) still asks under the rules engine', 'git push'),
    asks('rules', 'rm -rf "$HOME" asks', 'rm -rf "$HOME"'),
    asks('rules', 'rm -rf with a braced home asks', `rm -rf ${BRACED_HOME}`),
    asks('rules', 'rm -rf "$HOME"/* asks', 'rm -rf "$HOME"/*'),
    asks('rules', 'rm -rf ~ chained after another command asks', 'true && rm -rf ~'),
    asks('rules', 'rm -rfv ~ asks although its flags are not just rf', 'rm -rfv ~'),
    asks('rules', 'rm -rf -v "$HOME" asks although it has a flag besides rf', 'rm -rf -v "$HOME"'),
    runs('rules', 'rm -rf on an absolute path that is not / runs', `rm -rf ${sandbox}/build`),
    runs('rules', 'rm -rf on a path under ~ runs', `rm -rf ~/${absentHomeChild}`),
    runs('rules', 'rm -rf on a path under $HOME runs', `rm -rf $HOME/${absentHomeChild}`),
    runs('rules', 'rm -rf on a path under "$HOME" runs', `rm -rf "$HOME"/${absentHomeChild}`),
    runs(
      'rules',
      'rm -rf on a path under a braced home runs',
      `rm -rf ${BRACED_HOME}/${absentHomeChild}`,
    ),
    runs(
      'rules',
      'under the rules engine a quoted heredoc body that mentions a custom entry is text',
      quotedHeredoc('push.md', 'see `git push` in git.BS957yFf.js:276'),
    ),
    runs(
      'rules',
      'under the rules engine a command that only starts with "git" runs',
      'git.BS957yFf.js push || true',
    ),
  ];
}

export function readOutcome(stdout: string, callId: string): Observed {
  for (const line of stdout.split('\n')) {
    const event = fieldsOfJson(line);
    if (worded(event, 'type') === 'tool_result' && worded(event, 'id') === callId) {
      const message = worded(fieldsOf(event.get('error')), 'message');
      if (event.get('isError') !== true) {
        return 'runs';
      }
      if (message.includes(ASKED)) {
        return 'asks';
      }
      return message.includes(BLOCKED) ? 'blocked' : 'runs';
    }
  }
  return 'not run';
}

export interface CaseResult {
  denylistCase: DenylistCase;
  observed: Observed;
}

export interface Verdict {
  pass: boolean;
  text: string;
}

const SAID: Record<Exclude<Observed, 'not run'>, string> = {
  asks: 'asked for approval',
  blocked: 'blocked it outright',
  runs: 'ran without asking',
};

function refused(observed: Observed): boolean {
  return observed === 'asks' || observed === 'blocked';
}

export function caseVerdict({ denylistCase, observed }: CaseResult): Verdict {
  const { what, command, engine, expect } = denylistCase;
  const shown = `${JSON.stringify(command)} (${engine} engine)`;
  if (observed === 'not run') {
    return {
      pass: false,
      text: `not exercised: Droid never answered the Execute call, so "${what}" was not checked: ${shown}`,
    };
  }
  const pass = expect === 'asks' ? refused(observed) : observed === 'runs';
  if (!pass) {
    return { pass, text: `${what}, but Droid ${SAID[observed]}: ${shown}` };
  }
  const note = observed === 'blocked' ? ' (refused either way, nothing ran)' : '';
  return { pass, text: `${what}: Droid ${SAID[observed]}${note}: ${shown}` };
}

export function describeVerdicts(verdicts: readonly Verdict[]): string {
  return verdicts.map((verdict) => `${verdict.pass ? 'ok  ' : 'FAIL'}  ${verdict.text}`).join('\n');
}

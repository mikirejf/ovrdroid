import { MS_PER_SECOND } from '../cli.ts';

const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const PROGRESS = new RegExp(`${ESC}\\]9;(?<payload>4;[^${BEL}${ESC}]*)${BEL}`, 'gu');

export const BUSY = '4;3;';
export const IDLE = '4;0;';

export interface Chunk {
  atMs: number;
  text: string;
}

export type MarkName = 'prompt' | 'turnEnded' | 'viewOpen' | 'finished' | 'exited' | 'switched';

export interface Recording {
  chunks: readonly Chunk[];
  marks: Readonly<Partial<Record<MarkName, number>>>;
}

export interface BusyEvidence {
  finish: Recording;
  switched: Recording | undefined;
  quit: Recording | undefined;
  view: readonly string[] | undefined;
}

export interface ProgressEvent {
  atMs: number;
  payload: string;
}

export interface Verdict {
  pass: boolean;
  text: string;
}

export function progressEvents(chunks: readonly Chunk[]): ProgressEvent[] {
  const starts: number[] = [];
  let all = '';
  for (const chunk of chunks) {
    starts.push(all.length);
    all += chunk.text;
  }
  return [...all.matchAll(PROGRESS)].flatMap((match) => {
    const index = starts.findLastIndex((start) => start <= match.index);
    const chunk = chunks[index];
    const payload = match.groups?.['payload'];
    return chunk === undefined || payload === undefined ? [] : [{ atMs: chunk.atMs, payload }];
  });
}

function payloadAt(events: readonly ProgressEvent[], atMs: number): string | undefined {
  return events.findLast((event) => event.atMs <= atMs)?.payload;
}

function between(events: readonly ProgressEvent[], from: number, to: number): ProgressEvent[] {
  return events.filter((event) => event.atMs >= from && event.atMs <= to);
}

function seen(payload: string | undefined): string {
  return payload === undefined ? 'no progress payload at all' : `ESC ]9;${payload}`;
}

function verdict(pass: boolean, passed: string, failed: string): Verdict {
  return { pass, text: pass ? passed : failed };
}

function missingMark(name: MarkName): Verdict {
  return { pass: false, text: `the probe never reached "${name}", so this was not checked` };
}

function duringTurn(recording: Recording, events: readonly ProgressEvent[]): Verdict {
  const { prompt, turnEnded } = recording.marks;
  if (prompt === undefined || turnEnded === undefined) {
    return missingMark(prompt === undefined ? 'prompt' : 'turnEnded');
  }
  const busy = between(events, prompt, turnEnded).find((event) => event.payload === BUSY);
  return verdict(
    busy !== undefined,
    `ESC ]9;${BUSY} arrived during the turn, ${Math.round(busy === undefined ? 0 : busy.atMs - prompt)}ms after the prompt`,
    'no ESC ]9;4;3 arrived during the turn',
  );
}

interface Check {
  name: MarkName;
  recording: Recording;
  events: readonly ProgressEvent[];
  text: string;
}

function holds({ name, recording, events, text }: Check): Verdict {
  const at = recording.marks[name];
  if (at === undefined) {
    return missingMark(name);
  }
  const last = payloadAt(events, at);
  return verdict(
    last === BUSY,
    `${text}: ${seen(last)}`,
    `${text}: expected ESC ]9;${BUSY} but the last was ${seen(last)}`,
  );
}

function clears({ name, recording, events, text }: Check): Verdict {
  const at = recording.marks[name];
  if (at === undefined) {
    return missingMark(name);
  }
  const last = payloadAt(events, at);
  return verdict(
    last === IDLE,
    `${text}: ${seen(last)}`,
    `${text}: expected ESC ]9;${IDLE} but the last was ${seen(last)}`,
  );
}

function singleClear(recording: Recording, events: readonly ProgressEvent[]): Verdict {
  const { prompt } = recording.marks;
  if (prompt === undefined) {
    return missingMark('prompt');
  }
  const run = events.filter((event) => event.atMs >= prompt);
  const idles = run.filter((event) => event.payload === IDLE);
  const [clear] = idles;
  const after = clear === undefined ? [] : run.slice(run.indexOf(clear) + 1);
  const pass = idles.length === 1 && after.length === 0;
  return verdict(
    pass,
    `the sub-agent finishing wrote exactly one ESC ]9;${IDLE} and no progress payload after it`,
    `expected exactly one ESC ]9;${IDLE} and nothing after it, saw: ${run.map((event) => event.payload).join(' ') || 'no progress payload at all'}`,
  );
}

export function chipVerdict(view: readonly string[] | undefined, model: string): Verdict {
  if (view === undefined) {
    return { pass: false, text: 'the droids view did not open, so the model chip was not checked' };
  }
  const line = view.find((candidate) => candidate.includes(model));
  return line === undefined
    ? { pass: false, text: `no droids-view row carried the ${model} chip` }
    : { pass: true, text: `a droids-view row carried the model chip: ${line.trim()}` };
}

export function busyVerdicts(
  evidence: BusyEvidence,
  model: string,
  { requireView }: { requireView: boolean },
): Verdict[] {
  const recording = evidence.finish;
  const events = progressEvents(recording.chunks);
  const verdicts = [
    duringTurn(recording, events),
    holds({
      name: 'turnEnded',
      recording,
      events,
      text: 'after the turn ended with the sub-agent still running the last payload was',
    }),
    ...(evidence.view === undefined && !requireView
      ? []
      : [
          holds({
            name: 'viewOpen',
            recording,
            events,
            text: 'with the droids view open and the sub-agent still running the last payload was',
          }),
          chipVerdict(evidence.view, model),
        ]),
    clears({
      name: 'finished',
      recording,
      events,
      text: 'after the sub-agent finished, with no key pressed, the last payload was',
    }),
    singleClear(recording, events),
    clears({
      name: 'exited',
      recording,
      events,
      text: 'after the process exited the last payload was',
    }),
  ];
  if (evidence.switched !== undefined) {
    verdicts.push(
      clears({
        name: 'switched',
        recording: evidence.switched,
        events: progressEvents(evidence.switched.chunks),
        text: 'after switching to a new session while the old one still had a sub-agent the last payload was',
      }),
    );
  }
  if (evidence.quit !== undefined) {
    verdicts.push(
      clears({
        name: 'exited',
        recording: evidence.quit,
        events: progressEvents(evidence.quit.chunks),
        text: 'after the process exited while a sub-agent was still running the last payload was',
      }),
    );
  }
  return verdicts;
}

export function anyFailed(verdicts: readonly Verdict[]): boolean {
  return verdicts.some((entry) => !entry.pass);
}

export function describeVerdicts(verdicts: readonly Verdict[]): string {
  return verdicts.map((entry) => `${entry.pass ? 'pass' : 'FAIL'}  ${entry.text}`).join('\n');
}

export function describeTimeline(title: string, recording: Recording): string {
  const events = progressEvents(recording.chunks);
  const origin = recording.marks.prompt ?? recording.chunks[0]?.atMs ?? 0;
  const rows = [
    ...events.map((event) => ({ atMs: event.atMs, text: `ESC ]9;${event.payload}` })),
    ...Object.entries(recording.marks).map(([name, atMs]) => ({ atMs, text: `-- ${name}` })),
  ].toSorted((left, right) => left.atMs - right.atMs);
  const lines = rows.map(
    (row) => `${((row.atMs - origin) / MS_PER_SECOND).toFixed(3).padStart(8)}s  ${row.text}`,
  );
  return [`# ${title}`, ...lines].join('\n');
}

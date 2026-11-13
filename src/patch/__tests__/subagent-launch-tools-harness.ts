import { subagentLaunchPatches } from '../subagent-launch-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { SONNET } from './subagent-model-harness.ts';

export const HIDDEN = 'TodoWrite';
export const READ_ONLY = ['Read', 'Grep', 'Glob', 'Execute', 'Skill', HIDDEN];
export const EVERYTHING = [...READ_ONLY, 'Edit', 'Create', 'ApplyPatch', 'Task'];
export const GPT = 'custom:gpt-5';

interface FakeDroid {
  metadata: { tools: string[] | 'read-only' | undefined; model?: string };
}

export interface ToolSelection {
  resolved: string[];
  errors: string[];
}

interface FakeTools {
  expandTools: (options: { tools: FakeDroid['metadata']['tools']; model: string }) => ToolSelection;
  $ODdroidTools: (droid: FakeDroid, model: string) => ToolSelection;
  usesReadOnlyPolicy: (tools: unknown) => boolean;
}

interface Picked {
  modelId?: string;
  $ODtoolModel?: string;
}

interface PickInputs {
  fixedModel: string | undefined;
  declaredModel: string | undefined;
}

type Pick = (launch: unknown, inputs: PickInputs) => Picked;

export type Level = 'off' | 'low' | 'medium' | 'high';

const RANK: Record<Level, number> = { off: 0, low: 1, medium: 2, high: 3 };

export function lowerOf(level: Level, cap: Level): Level {
  return RANK[level] <= RANK[cap] ? level : cap;
}

interface FakeLauncher {
  resolveSubagentAutonomyLevel: (dependencies: unknown, droidIsReadOnly?: boolean) => Level;
}

interface LaunchRun {
  tools: string[];
  restricted: boolean;
  readOnlyPolicy: boolean;
  modelId: string | undefined;
  autonomy: Level;
}

interface LaunchError {
  llmError: string;
  userError: string;
}

interface Launched extends LaunchRun {
  pickInputs: PickInputs;
}

const EDIT_TOOLS = new Set(['Edit', 'Create', 'ApplyPatch']);

function listFor(tools: FakeDroid['metadata']['tools']): string[] {
  if (tools === 'read-only') {
    return READ_ONLY;
  }
  return tools === undefined ? EVERYTHING : [...new Set([...tools, HIDDEN])];
}

export function expandedFor(tools: FakeDroid['metadata']['tools'], model: string): string[] {
  const base = listFor(tools);
  if (!base.some((id) => EDIT_TOOLS.has(id)) || (model !== GPT && model !== SONNET)) {
    return base;
  }
  const rest = base.filter((id) => !EDIT_TOOLS.has(id));
  return model === GPT ? [...rest, 'ApplyPatch'] : [...rest, 'Edit', 'Create'];
}

function toolsOf(events: string[], selections: readonly ToolSelection[] = []): FakeTools {
  const expandTools: FakeTools['expandTools'] = ({ tools, model }) => {
    events.push(`expand:${model}`);
    return { resolved: expandedFor(tools, model), errors: [] };
  };
  let attempt = 0;
  return {
    expandTools,
    $ODdroidTools: (droid, model) => {
      const selection = selections[attempt];
      attempt += 1;
      if (selection === undefined) {
        return expandTools({ tools: droid.metadata.tools, model });
      }
      events.push(`expand:${model}`);
      return selection;
    },
    usesReadOnlyPolicy: (tools) => tools === 'read-only',
  };
}

export function patched(name: string): string {
  return patchNamed(subagentLaunchPatches, name).replace;
}

type WaitForStartup = (startup: Promise<void>, signal: AbortSignal | undefined) => Promise<void>;
type StartupService = () => { whenStartupSettles: () => Promise<void> } | undefined;

export class LaunchCancelledError extends Error {
  override name = 'LaunchCancelledError';
}

const build = payloadFunction<
  [
    { readonly: boolean | undefined },
    FakeDroid,
    FakeTools,
    string | undefined,
    Pick,
    FakeLauncher,
    typeof lowerOf,
    StartupService,
    WaitForStartup,
    typeof LaunchCancelledError,
    { abortSignal?: AbortSignal },
  ],
  () => Promise<LaunchRun | LaunchError>
>(
  ['t', 'R', 'vi', 'F', '$ODpick', 'Ie', 'Rs', 'xc', 'xa', 'xe', 'o'],
  'return async()=>{' +
    `let $ODl,A,lw,l="probe",$ODids=()=>[],v={type:"custom"},${patched('task-launch-picks-model-then-expands-tools')},` +
    `${patched('task-readonly-applies-read-only-policy')},${patched('task-readonly-restricts-enabled-tools')};` +
    'return{tools:_,restricted:ye,readOnlyPolicy:V,modelId:O,autonomy:q}}',
);

interface LaunchOptions {
  droidModel?: string;
  declaredModel?: string;
  picked?: Picked;
  events?: string[];
  session?: Level;
  selections?: readonly ToolSelection[];
  startup?: () => Promise<void>;
  wait?: WaitForStartup;
  abortSignal?: AbortSignal;
}

export async function launchTools(
  readonly: boolean | undefined,
  tools?: FakeDroid['metadata']['tools'],
  options: LaunchOptions = {},
): Promise<Launched> {
  const events = options.events ?? [];
  const metadata: FakeDroid['metadata'] = { tools };
  if (options.declaredModel !== undefined) {
    metadata.model = options.declaredModel;
  }
  let seen: PickInputs | undefined;
  const { startup } = options;
  const session = options.session ?? 'high';
  const result = await build(
    { readonly },
    { metadata },
    toolsOf(events, options.selections),
    options.droidModel,
    (_launch, inputs) => {
      events.push('pick');
      seen = inputs;
      return options.picked ?? {};
    },
    {
      resolveSubagentAutonomyLevel: (_dependencies, droidIsReadOnly = false) =>
        droidIsReadOnly ? lowerOf(session, 'low') : session,
    },
    lowerOf,
    () => (startup === undefined ? undefined : { whenStartupSettles: startup }),
    options.wait ??
      (async (promise) => {
        await promise;
      }),
    LaunchCancelledError,
    options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal },
  )();
  if ('llmError' in result) {
    throw new Error(`${result.llmError}\n${result.userError}`);
  }
  if (seen === undefined) {
    throw new TypeError('the launcher never called the pick');
  }
  return { ...result, pickInputs: seen };
}

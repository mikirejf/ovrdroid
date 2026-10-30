import type { EventEmitter } from 'node:events';

import { patchSource } from '../../binary/apply.ts';
import { fileTrackerPatches } from '../file-tracker-patches.ts';
import { rebaseAll } from '../rebase.ts';
import type { FakeTracker } from './file-tracker-harness.ts';
import { busWithListeners, NO_HOOKS, runOn, stamp } from './file-tracker-harness.ts';
import { moduleHolding, textOf } from './ink-frame-harness.ts';
import { declarationAround, declarationText } from './module-closure.ts';
import { rebasedNamed } from './payload.ts';
import type { Stand } from './session-mention-harness.ts';
import { requireStock } from './stock-scanner.ts';
import { evaluateProgram } from './stream-render-harness.ts';

const NESTED_PATCH = 'nested-tool-call-notice';

const ID = String.raw`[\w$]+`;

const ROLES = {
  admit: String.raw`=await (?<admit>${ID})\(${ID},${ID},${ID}\),${ID}=\(\)=>\(`,
  sandbox: String.raw`=\(\)=>\((?<sandbox>${ID})\(${ID},${ID},${ID}\),`,
  run: String.raw`\(${ID},${ID},${ID}\),(?<run>${ID})\(\{toolName:`,
  limits: String.raw`\}\},\.\.\.(?<limits>${ID})\}\)\)`,
  span: String.raw`=\(\)=>(?<span>${ID})\(${ID},\{sessionId:`,
  parent: String.raw`\.\.\.(?<parent>${ID})\(${ID}\.parentToolUseId\)`,
  queue: String.raw`=await (?<queue>${ID})\(${ID}\.sessionId,${ID}\.tool,`,
} as const;

type Role = keyof typeof ROLES;

function rolesIn(source: string): Record<Role, string> {
  const entries = Object.entries(ROLES).map(([role, pattern]) => {
    const name = new RegExp(pattern, 'u').exec(source)?.groups?.[role];
    if (name === undefined) {
      throw new Error(`the nested dispatch has no ${role} where the tests expect it`);
    }
    return [role, name] as const;
  });
  // SAFETY: entries holds one pair per key of ROLES.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<Role, string>;
}

interface Dispatcher {
  moduleText: string;
  name: string;
  source: string;
}

export type Build = 'stock' | 'patched';

const dispatchers = new Map<Build, Dispatcher>();

function dispatcher(build: Build): Dispatcher {
  const cached = dispatchers.get(build);
  if (cached !== undefined) {
    return cached;
  }
  const stock = requireStock();
  const { find } = rebasedNamed(
    rebaseAll(
      fileTrackerPatches,
      stock.map((module) => module.text),
    ),
    NESTED_PATCH,
  );
  const chunk = moduleHolding(stock, find);
  const stockText = textOf(stock, chunk);
  const name = declarationAround(stockText, stockText.indexOf(find));
  const moduleText = textOf(
    build === 'stock' ? stock : patchSource(stock, fileTrackerPatches),
    chunk,
  );
  const found = { moduleText, name, source: declarationText(moduleText, name) };
  dispatchers.set(build, found);
  return found;
}

export interface NestedResult {
  isError: boolean;
  content: string;
  llmReminders?: string[];
}

export type NestedTool = (input: Stand, toolCallId: string) => Promise<string> | string;

type Nested = (toolUseId: string, toolName: string, input: Stand) => Promise<NestedResult>;

interface ToolRequest {
  toolName: string;
  toolInput: Stand;
  context: { toolCallId: string };
}

type Body = () => Promise<Stand>;

async function admit(_dependencies: Stand, call: { toolName: string; input: Stand }) {
  await Bun.sleep(0);
  return {
    toolInput: call.input,
    preflight: {},
    admitted: { tool: { id: call.toolName } },
    confirmationAutonomyLevel: undefined,
    decision: {},
  };
}

export function nestedDispatch(
  build: Build,
  bus: EventEmitter,
  tools: ReadonlyMap<string, NestedTool>,
): Nested {
  const { moduleText, name, source } = dispatcher(build);
  const roles = rolesIn(source);
  const run = async (request: ToolRequest) => {
    await Bun.sleep(0);
    const tool = tools.get(request.toolName);
    if (tool === undefined) {
      throw new Error(`no stand-in for ${request.toolName}`);
    }
    return { value: await tool(request.toolInput, request.context.toolCallId) };
  };
  const dispatch = evaluateProgram<Record<string, Stand>>({
    moduleText,
    source,
    returns: [name],
    overrides: new Map<string, Stand>([
      [roles.admit, admit],
      [roles.sandbox, () => {}],
      [roles.run, run],
      [roles.limits, {}],
      [roles.span, async (_dependencies: Stand, _call: Stand, body: Body) => await body()],
      [roles.parent, () => ({})],
      [roles.queue, async (_session: string, _tool: Stand, body: Body) => await body()],
      ['process', bus],
    ]),
  })[name];
  // SAFETY: the stock dispatcher takes dependencies, the call and options, and resolves a result.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const call = dispatch as (
    dependencies: Stand,
    request: Stand,
    options: Stand,
  ) => Promise<NestedResult>;
  return async (toolUseId, toolName, input) =>
    await call(
      { sessionId: 's', toolCallId: toolUseId, abortSignal: new AbortController().signal },
      { toolUseId, toolName, input },
      { isCallCancelled: () => false },
    );
}

interface EditInput {
  path: string;
  text: string;
  at: number;
}

export interface ExecuteInput {
  files?: Record<string, string>;
  at?: number;
  waitBefore?: Promise<unknown>;
  onWrote?: () => void;
  waitAfter?: Promise<unknown>;
  fails?: string;
}

type Stamp = (path: string, text: string, secondsAfterBase: number) => string;

function scriptTools(tracker: FakeTracker, writeFile: Stamp): Map<string, NestedTool> {
  return new Map<string, NestedTool>([
    [
      'Edit',
      (input, toolCallId) => {
        // SAFETY: the tests pass Edit a path, the new text and when it lands.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const { path, text, at } = input as EditInput;
        if (tracker.hasFileChangedExternally(path)) {
          throw new Error(`File ${path} has been modified externally since it was last read`);
        }
        writeFile(path, text, at);
        tracker.track(path, toolCallId, 'edit');
        return 'edited';
      },
    ],
    [
      'Execute',
      async (input) => {
        // SAFETY: the tests pass Execute what it writes, when, and what it waits for.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const { files = {}, at = 0, waitBefore, onWrote, waitAfter, fails } = input as ExecuteInput;
        await waitBefore;
        for (const [path, text] of Object.entries(files)) {
          writeFile(path, text, at);
        }
        onWrote?.();
        await waitAfter;
        if (fails !== undefined) {
          throw new Error(fails);
        }
        return 'ran';
      },
    ],
  ]);
}

export function nestedOn(build: Build, tracker: FakeTracker) {
  const bus = busWithListeners(tracker);
  const nested = nestedDispatch(build, bus, scriptTools(tracker, stamp));
  const script = async (body: () => Promise<void>) =>
    await runOn(bus, { tracker, id: 'script-1', name: 'Script', hooks: NO_HOOKS, tool: body });
  return { nested, script };
}

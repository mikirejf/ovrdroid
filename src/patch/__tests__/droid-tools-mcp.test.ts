import { describe, expect, test } from 'bun:test';

import {
  DROID_TOOLS_METHOD,
  MCP_ENTRY_PARSER,
  STOCK_MCP_ENTRY_PARSER,
} from '../subagent-launch-patches.ts';
import { holePattern, literalParts } from '../tokens.ts';
import { payloadFunction } from './payload.ts';
import { stockDroid, stockText } from './stock-scanner.ts';

interface Tool {
  id: string;
  llmId?: string;
  isMcpTool?: boolean;
  toolkit?: string;
  mcpIdentity?: { serverName: string; toolName: string };
  deferred?: boolean;
}

interface McpRef {
  serverName: string;
  toolName?: string;
}

interface Normalized {
  resolved: string[];
  errors: string[];
  warnings?: string[];
}

type Tools = string[] | string | undefined;

interface Droid {
  metadata: { name: string; tools: Tools; mcpServers?: string[] };
}

interface DroidTools {
  $ODdroidTools: (droid: Droid, model: string) => Normalized;
}

const BUILT_IN = ['Read', 'Grep', 'Execute', 'ToolSearch', 'TodoWrite', 'Edit'];
const HIDDEN = 'TodoWrite';

function builtIn(llmId: string): Tool {
  return { id: `${llmId.toLowerCase()}-cli`, llmId };
}

function mcpTool(serverName: string, toolName: string): Tool {
  return {
    id: `${serverName}___${toolName}`,
    isMcpTool: true,
    toolkit: `mcp:${serverName}`,
    mcpIdentity: { serverName, toolName },
    deferred: true,
  };
}

const CHROME = ['click', 'navigate_page'].map((name) => mcpTool('chrome-devtools', name));
const REGISTRY: Tool[] = [...BUILT_IN.map((llmId) => builtIn(llmId)), ...CHROME];

const STOCK_SERVER_MATCH =
  'function UAe(e,t,{foldCase:o=!1}={}){let n=new Set(e.flatMap((a)=>a.mcpIdentity?.serverName??[])),s=new Set;' +
  'for(let a of t){let c=a.serverName.trim(),u=!o&&n.has(c)?(d)=>d===c:(d)=>um(d)===um(c);' +
  'for(let d of e){let p=d.mcpIdentity;if(p&&u(p.serverName)&&(a.toolName===void 0||p.toolName===a.toolName))s.add(d)}}' +
  'return e.filter((a)=>s.has(a))}';

const serverMatch = payloadFunction<[], (tools: Tool[], refs: McpRef[]) => Tool[]>(
  [],
  `function um(e){return e.toLowerCase()}return ${STOCK_SERVER_MATCH}`,
)();

function idOf(tool: Tool): string {
  if (tool.mcpIdentity !== undefined) {
    return `mcp:${encodeURIComponent(tool.mcpIdentity.serverName)}/${encodeURIComponent(tool.mcpIdentity.toolName)}`;
  }
  return tool.llmId ?? tool.id;
}

function normalizerFor(registry: readonly Tool[]): (list: string[]) => Normalized {
  const known = new Map(
    registry.flatMap((tool) => [
      [tool.llmId ?? tool.id, idOf(tool)],
      [idOf(tool), idOf(tool)],
    ]),
  );
  return (list) => {
    const invalid = list.filter((name) => !known.has(name));
    const valid = list.filter((name) => known.has(name));
    return {
      resolved: [...new Set([...valid.map((name) => known.get(name)), HIDDEN])].filter(
        (name): name is string => name !== undefined,
      ),
      errors:
        invalid.length > 0
          ? [
              `Invalid tools: ${invalid.join(', ')}. Available tools: ${[...known.keys()].join(', ')}`,
            ]
          : [],
    };
  };
}

const build = payloadFunction<
  [
    () => { getAllTools: () => Tool[] },
    typeof serverMatch,
    (servers: string[]) => string[],
    (list: string[]) => Normalized,
    typeof idOf,
  ],
  DroidTools
>(
  ['Ye', 'J4', 'rn', '$ODnormalize', 'mt'],
  `return class{${DROID_TOOLS_METHOD}` +
    'static expandTools($ODo){return{resolved:["stock:"+String($ODo.tools)],errors:[]}}' +
    'static normalizeTools($ODl){return $ODnormalize($ODl)}}',
);

function toolsFor(
  registry: readonly Tool[] = REGISTRY,
  normalize = normalizerFor(registry),
): DroidTools {
  const all = [...registry];
  return build(
    () => ({ getAllTools: () => all }),
    serverMatch,
    (servers) =>
      serverMatch(
        all,
        servers.map((serverName) => ({ serverName })),
      ).map((tool) => idOf(tool)),
    normalize,
    idOf,
  );
}

function droid(tools: Tools, mcpServers?: string[]): Droid {
  return {
    metadata:
      mcpServers === undefined ? { name: 'probe', tools } : { name: 'probe', tools, mcpServers },
  };
}

function resolve(tools: Tools, mcpServers?: string[], registry?: readonly Tool[]): string[] {
  return toolsFor(registry).$ODdroidTools(droid(tools, mcpServers), 'inherit').resolved;
}

function launchError(tools: Tools, mcpServers?: string[]): string {
  try {
    resolve(tools, mcpServers);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'the launch did not fail';
}

function missingFrom(tools: readonly string[], wanted: readonly string[]): string[] {
  return wanted.filter((id) => !tools.includes(id));
}

const CHROME_IDS = CHROME.map((tool) => idOf(tool));

describe('a tools list gains the MCP tools the droid names', () => {
  test('mcpServers adds every tool of that server on top of the list', () => {
    expect(resolve(['Read', 'ToolSearch'], ['chrome-devtools']).toSorted()).toEqual(
      ['Read', 'ToolSearch', HIDDEN, ...CHROME_IDS].toSorted(),
    );
  });

  test('an MCP:<server> entry adds every tool of that server', () => {
    expect(
      missingFrom(resolve(['Read', 'MCP:chrome-devtools']), ['Read', 'ToolSearch', ...CHROME_IDS]),
    ).toEqual([]);
  });

  test('an MCP:<server>/<tool> entry adds that one tool', () => {
    const tools = resolve(['Read', 'MCP:chrome-devtools/click'], []);
    expect(tools).toContain('mcp:chrome-devtools/click');
    expect(tools).not.toContain('mcp:chrome-devtools/navigate_page');
  });

  test('the MCP: prefix and the server name match in any case', () => {
    expect(missingFrom(resolve(['mcp:Chrome-DevTools']), CHROME_IDS)).toEqual([]);
  });

  test('a running MCP tool named by its llmId still works', () => {
    expect(resolve(['Read', 'chrome-devtools___click'])).toContain('mcp:chrome-devtools/click');
  });

  test('server and tool names use stock percent-encoded canonical IDs', () => {
    const tool = mcpTool('my/server', 'tool x');
    expect(resolve(['MCP:my%2Fserver/tool%20x'], [], [tool])).toContain('mcp:my%2Fserver/tool%20x');
  });

  test('an exact-case server entry selects only that server, not its case-folded neighbour', () => {
    const registry = [...REGISTRY, mcpTool('Chrome-DevTools', 'other')];
    expect(resolve(['MCP:chrome-devtools'], [], registry)).not.toContain(
      'mcp:Chrome-DevTools/other',
    );
  });
});

test('the MCP additions preserve stock normalization errors and warnings for the launch', () => {
  const selection = toolsFor(REGISTRY, () => ({
    resolved: ['Read'],
    errors: ['Tool Task cannot be enabled.'],
    warnings: ['A saved tool was deprecated.'],
  })).$ODdroidTools(droid(['Read'], ['chrome-devtools']), 'inherit');
  expect(selection.errors).toEqual(['Tool Task cannot be enabled.']);
  expect(selection.warnings).toEqual(['A saved tool was deprecated.']);
  expect(missingFrom(selection.resolved, ['Read', 'ToolSearch', ...CHROME_IDS])).toEqual([]);
});

describe('ToolSearch follows the deferred tools', () => {
  test('a deferred MCP tool brings ToolSearch even when the list leaves it out', () => {
    expect(resolve(['Read'], ['chrome-devtools'])).toContain('ToolSearch');
  });

  test('a list with no deferred tool gets no ToolSearch it did not ask for', () => {
    expect(resolve(['Read'], [])).not.toContain('ToolSearch');
  });
});

describe('a tools list with no mcpServers field keeps every MCP tool', () => {
  test('every MCP tool and ToolSearch join the list', () => {
    expect(resolve(['Read', 'ToolSearch']).toSorted()).toEqual(
      ['Read', 'ToolSearch', HIDDEN, ...CHROME_IDS].toSorted(),
    );
  });

  test('the deferred MCP tools bring ToolSearch', () => {
    expect(resolve(['Read'])).toContain('ToolSearch');
  });

  test('an empty mcpServers list keeps every MCP tool out', () => {
    expect(resolve(['Read', 'ToolSearch'], []).toSorted()).toEqual(
      ['Read', 'ToolSearch', HIDDEN].toSorted(),
    );
  });

  test('a named server limits the list to its own tools', () => {
    const registry = [...REGISTRY, mcpTool('other', 'x')];
    const named = resolve(['Read'], ['chrome-devtools'], registry);
    expect(missingFrom(named, CHROME_IDS)).toEqual([]);
    expect(named).not.toContain('mcp:other/x');
    const unnamed = resolve(['Read'], undefined, registry);
    expect(missingFrom(unnamed, [...CHROME_IDS, 'mcp:other/x'])).toEqual([]);
  });
});

describe('a server that is not there is skipped quietly', () => {
  test.each([
    ['mcpServers', ['Read'], ['no-such-server']],
    ['an MCP:<server> entry', ['Read', 'MCP:no-such-server'], []],
    ['an MCP:<server>/<tool> entry', ['Read', 'MCP:no-such-server/click'], []],
    ['an <server>___<tool> name', ['Read', 'no-such-server___click'], []],
  ] as const)('via %s', (_label, tools, servers) => {
    expect(resolve([...tools], [...servers])).toEqual(['Read', HIDDEN]);
  });

  test('a configured server whose tools have not loaded yet counts as not there', () => {
    expect(
      resolve(
        ['Read', 'MCP:chrome-devtools'],
        undefined,
        BUILT_IN.map((llmId) => builtIn(llmId)),
      ),
    ).toEqual(['Read', HIDDEN]);
  });
});

describe('a name the droid cannot mean stops the launch', () => {
  test('an unknown built-in name, with the droid named', () => {
    expect(launchError(['Read', 'Reed'])).toBe(
      'Droid "probe" lists tools that do not exist: Reed.',
    );
  });

  test.each(['MCP:', 'MCP:a/b/c', 'MCP:chrome-devtools/', 'MCP:%E0%A4%A'])(
    'a malformed MCP entry: %s',
    (entry) => {
      expect(launchError(['Read', entry])).toBe(
        `Droid "probe" lists MCP entries it cannot read (write MCP:<server> or MCP:<server>/<tool>): ${entry}.`,
      );
    },
  );

  test.each(['MCP:chrome-devtools/clik', 'chrome-devtools___clik'])(
    'a misspelled tool on a running server: %s',
    (entry) => {
      expect(launchError(['Read', entry])).toBe(
        `Droid "probe" lists MCP tools their running server does not have: ${entry}.`,
      );
    },
  );

  test('every kind of bad entry is reported together', () => {
    const message = launchError(['Reed', 'MCP:', 'MCP:chrome-devtools/clik']);
    expect(message).toContain('do not exist: Reed');
    expect(message).toContain('cannot read');
    expect(message).toContain('does not have: MCP:chrome-devtools/clik');
  });
});

describe('a droid without a tools list keeps the stock expansion', () => {
  test.each([
    ['no tools field', undefined],
    ['the read-only category', 'read-only'],
  ] as const)('%s', (_label, tools) => {
    expect(resolve(tools, ['chrome-devtools'])).toEqual([`stock:${String(tools)}`]);
  });

  test('a comma string is read as a list', () => {
    expect(missingFrom(resolve('Read, MCP:chrome-devtools'), CHROME_IDS)).toEqual([]);
  });
});

type Parser = (entry: string) => McpRef | undefined;

const stockParser = payloadFunction<[], Parser>(
  [],
  `let pc="mcp:";return ${STOCK_MCP_ENTRY_PARSER.replace('function lr', 'function')}`,
)();
const copiedParser = payloadFunction<[], Parser>([], `return ${MCP_ENTRY_PARSER}`)();

function outcome(parse: Parser, entry: string): McpRef | string | undefined {
  try {
    return parse(entry);
  } catch (error) {
    return error instanceof Error ? error.name : 'thrown';
  }
}

describe('the payload reads MCP: entries exactly as stock lr does', () => {
  test.each([
    'MCP:chrome-devtools',
    ' mcp:chrome-devtools/click ',
    'MCP:',
    'MCP:/click',
    'MCP:a/b/c',
    'MCP:a/',
    'MCP:%20',
    'MCP:my%2Fserver/tool%20x',
    'MCP:%E0%A4%A',
  ])('%s', (entry) => {
    expect(outcome(copiedParser, entry)).toEqual(outcome(stockParser, entry));
  });
});

describe.skipIf(stockDroid === undefined)('the copied parser still matches the shipped one', () => {
  test('the MCP matcher is in the shipped source exactly once', () => {
    const pattern = new RegExp(holePattern(STOCK_SERVER_MATCH).source, 'gu');
    expect([...stockText.matchAll(pattern)]).toHaveLength(1);
  });

  test('stock lr is in the shipped source exactly once', () => {
    const pattern = new RegExp(holePattern(STOCK_MCP_ENTRY_PARSER).source, 'gu');
    expect(literalParts(STOCK_MCP_ENTRY_PARSER).every((part) => stockText.includes(part))).toBe(
      true,
    );
    expect([...stockText.matchAll(pattern)]).toHaveLength(1);
  });

  test('the payload names the tool search tool by the name the shipped one has', () => {
    expect(DROID_TOOLS_METHOD).toContain('$ODids.add("ToolSearch")');
    expect(stockText.split('id:"tool-search-cli",llmId:"ToolSearch"')).toHaveLength(2);
  });
});

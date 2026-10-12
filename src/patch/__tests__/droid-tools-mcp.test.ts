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
}

type Tools = string[] | string | undefined;

interface Droid {
  metadata: { name: string; tools: Tools; mcpServers?: string[] };
}

interface DroidTools {
  $ODdroidTools: (droid: Droid, model: string) => string[];
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

const STOCK_SERVER_MATCH = String.raw`return a.filter((p)=>{if(!p.isMcpTool||typeof p.toolkit!=="string")return!1;let m=p.mcpIdentity?.serverName??(p.toolkit.toLowerCase().startsWith("mcp:")?p.toolkit.slice(4):void 0);if(m===void 0)return!1;return l.some((_)=>m.toLowerCase()===_.serverName.trim().toLowerCase()&&(_.toolName===void 0||p.mcpIdentity?.toolName===_.toolName))})`;

const serverMatch = payloadFunction<[Tool[], McpRef[]], Tool[]>(['a', 'l'], STOCK_SERVER_MATCH);

function idOf(tool: Tool): string {
  return tool.llmId ?? tool.id;
}

function normalizerFor(registry: readonly Tool[]): (list: string[]) => Normalized {
  const known = new Set(registry.map((tool) => idOf(tool)));
  return (list) => {
    const invalid = list.filter((name) => !known.has(name));
    const valid = list.filter((name) => known.has(name));
    return {
      resolved: [...new Set([...valid, HIDDEN])],
      errors:
        invalid.length > 0
          ? [`Invalid tools: ${invalid.join(', ')}. Available tools: ${[...known].join(', ')}`]
          : [],
    };
  };
}

const build = payloadFunction<
  [
    () => { getAllTools: () => Tool[] },
    typeof serverMatch,
    (servers: string[]) => string[],
    Tool,
    (list: string[]) => Normalized,
  ],
  DroidTools
>(
  ['Ye', 'J4', 'rn', 'Tr', '$ODnormalize'],
  `return class{${DROID_TOOLS_METHOD}` +
    'static expandTools($ODo){return["stock:"+String($ODo.tools)]}' +
    'static normalizeTools($ODl){return $ODnormalize($ODl)}}',
);

function toolsFor(registry: readonly Tool[] = REGISTRY): DroidTools {
  const all = [...registry];
  return build(
    () => ({ getAllTools: () => all }),
    serverMatch,
    (servers) =>
      serverMatch(
        all,
        servers.map((serverName) => ({ serverName })),
      ).map((tool) => idOf(tool)),
    builtIn('ToolSearch'),
    normalizerFor(all),
  );
}

function droid(tools: Tools, mcpServers?: string[]): Droid {
  return {
    metadata:
      mcpServers === undefined ? { name: 'probe', tools } : { name: 'probe', tools, mcpServers },
  };
}

function resolve(tools: Tools, mcpServers?: string[], registry?: readonly Tool[]): string[] {
  return toolsFor(registry).$ODdroidTools(droid(tools, mcpServers), 'inherit');
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
    const tools = resolve(['Read', 'MCP:chrome-devtools/click']);
    expect(tools).toContain('chrome-devtools___click');
    expect(tools).not.toContain('chrome-devtools___navigate_page');
  });

  test('the MCP: prefix and the server name match in any case', () => {
    expect(missingFrom(resolve(['mcp:Chrome-DevTools']), CHROME_IDS)).toEqual([]);
  });

  test('a running MCP tool named by its llmId still works', () => {
    expect(resolve(['Read', 'chrome-devtools___click'])).toContain('chrome-devtools___click');
  });
});

describe('ToolSearch follows the deferred tools', () => {
  test('a deferred MCP tool brings ToolSearch even when the list leaves it out', () => {
    expect(resolve(['Read'], ['chrome-devtools'])).toContain('ToolSearch');
  });

  test('a list with no deferred tool gets no ToolSearch it did not ask for', () => {
    expect(resolve(['Read'])).not.toContain('ToolSearch');
  });
});

describe('a server that is not there is skipped quietly', () => {
  test.each([
    ['mcpServers', ['Read'], ['no-such-server']],
    ['an MCP:<server> entry', ['Read', 'MCP:no-such-server'], undefined],
    ['an MCP:<server>/<tool> entry', ['Read', 'MCP:no-such-server/click'], undefined],
    ['an <server>___<tool> name', ['Read', 'no-such-server___click'], undefined],
  ] as const)('via %s', (_label, tools, servers) => {
    expect(resolve([...tools], servers === undefined ? undefined : [...servers])).toEqual([
      'Read',
      HIDDEN,
    ]);
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
  `return ${STOCK_MCP_ENTRY_PARSER.replace('function lr', 'function')}`,
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
  test('stock lr is in the shipped source exactly once', () => {
    const pattern = new RegExp(holePattern(STOCK_MCP_ENTRY_PARSER).source, 'gu');
    expect(literalParts(STOCK_MCP_ENTRY_PARSER).every((part) => stockText.includes(part))).toBe(
      true,
    );
    expect([...stockText.matchAll(pattern)]).toHaveLength(1);
  });
});

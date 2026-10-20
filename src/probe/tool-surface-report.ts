import type { BodyRow, Json, JsonObject } from './bodies.ts';

const SCRIPT_TOOL = 'Script';

export interface ToolSurface {
  names: readonly string[];
  scriptOnly: boolean;
  direct: boolean;
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function isRecord(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !isList(value);
}

export function readToolNames(rows: readonly BodyRow[]): string[] | undefined {
  const tools = rows.at(-1)?.body['tools'];
  if (!isList(tools)) {
    return undefined;
  }
  return tools.flatMap((tool) => {
    const name = isRecord(tool) ? tool['name'] : undefined;
    return typeof name === 'string' ? [name] : [];
  });
}

export function readToolSurface(rows: readonly BodyRow[], tool: string): ToolSurface | undefined {
  const names = readToolNames(rows);
  return names === undefined
    ? undefined
    : { names, scriptOnly: names.includes(SCRIPT_TOOL), direct: names.includes(tool) };
}

export function describeToolSurface(surface: ToolSurface | undefined, tool: string): string {
  if (surface === undefined) {
    return 'the bodies file holds no request with a tool list: is the binary a `probe build --bodies` build, and did the session answer?';
  }
  const listed = surface.names.join(', ');
  if (!surface.scriptOnly) {
    return `the session is not in script_only mode (the model sees: ${listed}), so this says nothing about ${tool}: pick a model that runs Script`;
  }
  return surface.direct
    ? `${tool} is on the model's direct tool list, next to ${surface.names.filter((name) => name !== tool).join(', ')}`
    : `${tool} is not on the model's direct tool list in script_only mode (the model sees: ${listed}), so a direct call fails with Not found`;
}

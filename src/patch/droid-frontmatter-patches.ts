import type { Patch } from './patches.ts';

const MCP_SERVERS_FIELD =
  'mcpServers:Nt((t)=>typeof t==="string"?t.split(",").map((o)=>o.trim()).filter((o)=>o.length>0):t,d(e())).optional()';

const DROID_FRONTMATTER_FIELDS = ['complexity', 'maxDepth', 'skills'] as const;

export const droidFrontmatterPatches: readonly Patch[] = [
  {
    name: 'droid-frontmatter-keeps-new-fields',
    find: `${MCP_SERVERS_FIELD}}),WN=`,
    lookups: ['metadata:Y(ie()).optional(),'],
    replace: `${MCP_SERVERS_FIELD},${DROID_FRONTMATTER_FIELDS.map((field) => `${field}:ie().optional()`).join(',')}}),WN=`,
  },
  {
    name: 'droid-metadata-carries-new-fields',
    find: 'reasoningEffort:g.reasoningEffort,tools:g.tools,mcpServers:g.mcpServers,',
    replace: `reasoningEffort:g.reasoningEffort,tools:g.tools,mcpServers:g.mcpServers,${DROID_FRONTMATTER_FIELDS.map((field) => `${field}:g.${field},`).join('')}`,
  },
];

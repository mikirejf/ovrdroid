import { OVRDROID_UNDER_HOME } from '../paths.ts';
import type { Patch } from './patches.ts';

const MINUTE_MS = 60_000;

export const MCP_IDLE_ENV = 'OVRDROID_MCP_IDLE_MS';
export const DEFAULT_MCP_IDLE_MS = 10 * MINUTE_MS;
export const MIN_MCP_IDLE_MS = 1000;
export const MCP_TOOLS_UNDER_HOME = `${OVRDROID_UNDER_HOME}/mcp-tools`;
export const MCP_TOOLS_KEY_LENGTH = 16;

const HELPERS =
  `var $ODMD=require("os").homedir()+"/${MCP_TOOLS_UNDER_HOME}";` +
  'function $ODMh(c){return c.type==="http"||c.type==="sse"}' +
  'function $ODMn(t,c){return $ODMD+"/"+require("crypto").createHash("sha256").update(t+"\\0"+JSON.stringify(c)).digest("hex")' +
  `.slice(0,${MCP_TOOLS_KEY_LENGTH})+".json"}` +
  'function $ODMr(t,c){try{let v=JSON.parse(require("fs").readFileSync($ODMn(t,c),"utf8"));return Array.isArray(v)?v:void 0}catch{return}}' +
  'function $ODMW(t,c,v){let F=require("fs").promises,f=$ODMn(t,c),p=f+"."+process.pid;' +
  'F.mkdir($ODMD,{recursive:!0}).then(()=>F.writeFile(p,JSON.stringify(v))).then(()=>F.rename(p,f)).catch(()=>{})}' +
  `function $ODMe(){let v=Number(process.env.${MCP_IDLE_ENV});return Number.isFinite(v)&&v>=${MIN_MCP_IDLE_MS}?v:${DEFAULT_MCP_IDLE_MS}}` +
  'function $ODMd(t,c){return{name:t,config:c,client:{},transport:{close:async()=>{}},$ODMz:!0}}';

const ADD =
  'async addServer(t,r){if($ODMh(r))return await this.$ODMspawn(t,r);' +
  'let e=this.servers[t],c=!e||e.$ODMz?$ODMr(t,r):void 0;' +
  'if(c){this.servers[t]=$ODMd(t,r),this.availableResources[t]=G(),this.toolsListCache.set(t,{state:"ready",tools:c}),' +
  'this.logger?.info("[ovrdroid] MCP server dormant until first use",{name:t});return}' +
  'await this.$ODMspawn(t,r),this.$ODMa(t)}';

const STATE =
  '$ODMg(t){let m=this.$ODMq??=new Map,q=m.get(t);if(!q)m.set(t,q={n:0});return q}' +
  '$ODMk(t){let q=this.$ODMq?.get(t);if(q)clearTimeout(q.t),this.$ODMq.delete(t)}';

const ARM =
  '$ODMa(t){let e=this.servers[t];if(!e||e.$ODMz||$ODMh(e.config))return;let q=this.$ODMg(t);if(clearTimeout(q.t),q.n)return;' +
  'q.t=setTimeout(()=>{this.$ODMo(t).catch((x)=>{this.logger?.warn("[ovrdroid] MCP idle stop failed",{server:t,error:x})})},$ODMe()),q.t.unref?.()}';

const SLEEP =
  'async $ODMo(t){let q=this.$ODMq?.get(t),e=this.servers[t];if(!q||q.n||!e||e.$ODMz)return;' +
  'if(Object.keys(this.clientResourceSubscriptions[t]??{}).length||this.toolsListCache.get(t)?.state!=="ready")return this.$ODMa(t);' +
  'let p=ii(e.transport),d=$ODMd(t,e.config);' +
  'd.$ODMstop=(async()=>{try{await e.transport.close()}catch(x){this.logger?.warn("[ovrdroid] MCP idle close failed",{server:t,error:x})}' +
  'try{if(p!==null&&ri(p))await this.killServerProcessTree(p,t)}catch(x){this.logger?.warn("[ovrdroid] MCP idle kill failed",{server:t,error:x})}})();' +
  'this.servers[t]=d,this.logger?.info("[ovrdroid] MCP server idle, stopping until next use",{server:t,pid:p});await d.$ODMstop}' +
  'async $ODMsettle(t){let e=this.servers[t];await Promise.all([e?.$ODMstop,e?.$ODMb?.catch(()=>{})])}';

const WAKE =
  '$ODMw(t){let e=this.servers[t];if(!e?.$ODMz)return;' +
  'return e.$ODMb??=this.$ODMspawn(t,e.config).then(()=>{let n=this.servers[t];if(n&&e.$ODMstop)n.$ODMstop=e.$ODMstop;this.$ODMf(t)},(x)=>{throw e.$ODMb=void 0,x})}' +
  '$ODMf(t){this.fetchToolsForServer(t).then((v)=>{let c=this.toolsListCache.get(t);' +
  'if(c?.state!=="ready"||JSON.stringify(c.tools)!==JSON.stringify(v))return this.handleToolsListChanged(t)})' +
  '.catch((x)=>{this.logger?.warn("[ovrdroid] MCP tools refresh after wake failed",{server:t,error:x})})}';

const USE =
  'async $ODMu(t,f){let e=this.servers[t];if(!e||$ODMh(e.config))return await f();' +
  'let q=this.$ODMg(t);q.n++,clearTimeout(q.t);try{return await this.$ODMw(t),await f()}finally{if(!--q.n)this.$ODMa(t)}}';

const FETCH =
  'async fetchToolsForServer(t){return await this.$ODMu(t,async()=>{let v=await this.$ODMlist(t),e=this.servers[t],c=this.toolsListCache.get(t);' +
  'if(e&&!$ODMh(e.config)&&(c?.state!=="ready"||JSON.stringify(c.tools)!==JSON.stringify(v)))$ODMW(t,e.config,v);return v})}';

const ADD_SERVER_HEAD =
  'let s=performance.now(),o=r.type==="http"||r.type==="sse"?"remote":"stdio",l="success",u;try{let p=this.servers[t];if(p';

export const mcpIdlePatches: readonly Patch[] = [
  {
    name: 'mcp-idle-helpers',
    find: 'class Ft{logger;clientInfo;getOAuthDriver;',
    replace: `${HELPERS}class Ft{logger;clientInfo;getOAuthDriver;`,
  },
  {
    name: 'mcp-idle-add-server',
    find: `async addServer(t,r){${ADD_SERVER_HEAD}){`,
    replace: `${ADD}${STATE}${ARM}${SLEEP}${WAKE}${USE}async $ODMspawn(t,r){${ADD_SERVER_HEAD}&&!p.$ODMz){`,
  },
  {
    name: 'mcp-idle-fetch-tools',
    find: 'async fetchToolsForServer(t){let r=Date.now()+Dt(),',
    replace: `${FETCH}async $ODMlist(t){let r=Date.now()+Dt(),`,
  },
  {
    name: 'mcp-idle-call-tool',
    find: 'async callTool(t,r,s,o="unknown-session",l="AGENT",u=void 0){',
    replace:
      'async callTool(...a){return await this.$ODMu(a[0],()=>this.$ODMcall(...a))}' +
      'async $ODMcall(t,r,s,o="unknown-session",l="AGENT",u=void 0){',
  },
  {
    name: 'mcp-idle-read-resource',
    find: 'async readResource(t,r){if(!this.servers[t])',
    replace:
      'async readResource(t,r){return await this.$ODMu(t,()=>this.$ODMread(t,r))}' +
      'async $ODMread(t,r){if(!this.servers[t])',
  },
  {
    name: 'mcp-idle-subscribe',
    find: 'async subscribeToServerResource(t,r){let s=this.servers[t];',
    replace:
      'async subscribeToServerResource(t,r){return await this.$ODMu(t,()=>this.$ODMsub(t,r))}' +
      'async $ODMsub(t,r){let s=this.servers[t];',
  },
  {
    name: 'mcp-idle-unsubscribe',
    find: 'async unsubscribeFromServerResource(t,r){let s=this.servers[t];',
    replace: 'async unsubscribeFromServerResource(t,r){let s=this.servers[t];if(s?.$ODMz)return;',
  },
  {
    name: 'mcp-idle-list-resources',
    find: 'async listResourcesForServer(t,r){if(!this.servers[t])throw new a("Server does not exist",{name:t});',
    replace:
      'async listResourcesForServer(t,r){if(this.servers[t]?.$ODMz)return[];return await this.$ODMu(t,()=>this.$ODMres(t,r))}' +
      'async $ODMres(t,r){if(!this.servers[t])throw new a("Server does not exist",{name:t});',
  },
  {
    name: 'mcp-idle-list-templates',
    find: 'async listResourceTemplatesForServer(t){if(!this.servers[t])throw new a("Server  does not exist",{name:t});',
    replace:
      'async listResourceTemplatesForServer(t){if(this.servers[t]?.$ODMz)return[];return await this.$ODMu(t,()=>this.$ODMtpl(t))}' +
      'async $ODMtpl(t){if(!this.servers[t])throw new a("Server  does not exist",{name:t});',
  },
  {
    name: 'mcp-idle-remove-server',
    find: 'async removeServer(t){if(!this.servers[t])throw new a("Server does not exist",{name:t});',
    replace:
      'async removeServer(t){await this.$ODMsettle(t);if(!this.servers[t])throw new a("Server does not exist",{name:t});this.$ODMk(t);',
  },
];

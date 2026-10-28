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
  'function $ODMh($ODcfg){return $ODcfg.type==="http"||$ODcfg.type==="sse"}' +
  'function $ODMn($ODname,$ODcfg){return $ODMD+"/"+require("crypto").createHash("sha256").update($ODname+"\\0"+JSON.stringify($ODcfg)).digest("hex")' +
  `.slice(0,${MCP_TOOLS_KEY_LENGTH})+".json"}` +
  'function $ODMr($ODname,$ODcfg){try{let $ODtools=JSON.parse(require("fs").readFileSync($ODMn($ODname,$ODcfg),"utf8"));return Array.isArray($ODtools)?$ODtools:void 0}catch{return}}' +
  'function $ODMW($ODname,$ODcfg,$ODtools){let $ODfsp=require("fs").promises,$ODfile=$ODMn($ODname,$ODcfg),$ODtmp=$ODfile+"."+process.pid;' +
  '$ODfsp.mkdir($ODMD,{recursive:!0}).then(()=>$ODfsp.writeFile($ODtmp,JSON.stringify($ODtools))).then(()=>$ODfsp.rename($ODtmp,$ODfile)).catch(()=>{})}' +
  `function $ODMe(){let $ODms=Number(process.env.${MCP_IDLE_ENV});return Number.isFinite($ODms)&&$ODms>=${MIN_MCP_IDLE_MS}?$ODms:${DEFAULT_MCP_IDLE_MS}}` +
  'function $ODMd($ODname,$ODcfg,$ODera){return{name:$ODname,config:$ODcfg,client:{},transport:{close:async()=>{}},eraNegotiation:$ODera,pid:null,$ODMz:!0}}';

const ADD =
  'async connectServer(t,r,h){if($ODMh(r))return await this.$ODMspawn(t,r,h);' +
  'let $ODold=this.servers[t],$ODtools=!this.shutdownController.signal.aborted&&(!$ODold||$ODold.$ODMz)?$ODMr(t,r):void 0;' +
  'if($ODtools){this.servers[t]=$ODMd(t,r,h),this.toolsListCache.set(t,{state:"ready",list:{tools:$ODtools}}),' +
  'this.logger?.info("[ovrdroid] MCP server dormant until first use",{name:t});return}' +
  'await this.$ODMspawn(t,r,h),this.$ODMa(t)}';

const STATE =
  '$ODMg($ODname){let $ODall=this.$ODMq??=new Map,$ODst=$ODall.get($ODname);if(!$ODst)$ODall.set($ODname,$ODst={n:0});return $ODst}' +
  '$ODMk($ODname){let $ODst=this.$ODMq?.get($ODname);if($ODst)clearTimeout($ODst.t),this.$ODMq.delete($ODname)}';

const ARM =
  '$ODMa($ODname){let $ODsrv=this.servers[$ODname];if(!$ODsrv||$ODsrv.$ODMz||$ODMh($ODsrv.config))return;let $ODst=this.$ODMg($ODname);if(clearTimeout($ODst.t),$ODst.n)return;' +
  '$ODst.t=setTimeout(()=>{this.$ODMo($ODname).catch(($ODerr)=>{this.logger?.warn("[ovrdroid] MCP idle stop failed",{server:$ODname,error:$ODerr})})},$ODMe()),$ODst.t.unref?.()}';

const SLEEP =
  'async $ODMo($ODname){let $ODst=this.$ODMq?.get($ODname),$ODsrv=this.servers[$ODname],$ODcache=this.toolsListCache.get($ODname);if(!$ODst||$ODst.n||!$ODsrv||$ODsrv.$ODMz)return;' +
  'if(Object.keys(this.clientResourceSubscriptions[$ODname]??{}).length||$ODcache?.state!=="ready")return this.$ODMa($ODname);' +
  'let $ODpid=$ODsrv.pid,$ODrelease=this.ownershipReleases.get($ODname),$ODdorm=$ODMd($ODname,$ODsrv.config,$ODsrv.eraNegotiation);$ODdorm.pid=$ODpid,this.ownershipReleases.delete($ODname);' +
  'this.toolsListCache.set($ODname,{state:"ready",list:{tools:$ODcache.list.tools}}),this.settledTools.delete($ODname);' +
  '$ODdorm.$ODMstop=(async()=>{try{$ODsrv.listenStream?.close(),await $ODsrv.transport.close()}catch($ODerr){this.logger?.warn("[ovrdroid] MCP idle close failed",{server:$ODname,error:$ODerr})}' +
  'try{if($ODpid!==null&&ri($ODpid))await this.killServerProcessTree($ODpid,$ODname)}catch($ODerr){this.logger?.warn("[ovrdroid] MCP idle kill failed",{server:$ODname,error:$ODerr})}$ODrelease?.(),$ODdorm.pid=null})();' +
  'this.servers[$ODname]=$ODdorm,this.logger?.info("[ovrdroid] MCP server idle, stopping until next use",{server:$ODname,pid:$ODpid});await $ODdorm.$ODMstop}' +
  'async $ODMsettle($ODname){let $ODsrv=this.servers[$ODname];await Promise.all([$ODsrv?.$ODMstop,$ODsrv?.$ODMb?.catch(()=>{})])}';

const WAKE =
  '$ODMw($ODname){let $ODsrv=this.servers[$ODname];if(!$ODsrv?.$ODMz)return;' +
  'return $ODsrv.$ODMb??=this.$ODMspawn($ODname,$ODsrv.config,$ODsrv.eraNegotiation).then(()=>{let $ODnow=this.servers[$ODname];if($ODnow&&$ODsrv.$ODMstop)$ODnow.$ODMstop=$ODsrv.$ODMstop;this.$ODMf($ODname)},($ODerr)=>{throw $ODsrv.$ODMb=void 0,$ODerr})}' +
  '$ODMf($ODname){let $ODprev=this.toolsListCache.get($ODname);if($ODprev?.state!=="ready")return;this.toolsListCache.delete($ODname);' +
  'this.listToolsForServer($ODname,{includeDisabled:!0}).then(({tools:$ODtools})=>{' +
  'if(JSON.stringify($ODprev.list.tools)!==JSON.stringify($ODtools))return this.handleToolsListChanged($ODname)})' +
  '.catch(($ODerr)=>{this.logger?.warn("[ovrdroid] MCP tools refresh after wake failed",{server:$ODname,error:$ODerr})})}';

const USE =
  'async $ODMu($ODname,$ODrun){let $ODsrv=this.servers[$ODname];if(!$ODsrv||$ODMh($ODsrv.config))return await $ODrun();' +
  'let $ODst=this.$ODMg($ODname);$ODst.n++,clearTimeout($ODst.t);try{return await this.$ODMw($ODname),await $ODrun()}finally{if(!--$ODst.n)this.$ODMa($ODname)}}';

const FETCH =
  'async requestToolsList(t){return await this.$ODMu(t,async()=>{let $ODlist=await this.$ODMlist(t),$ODsrv=this.servers[t];' +
  'if($ODsrv&&!$ODMh($ODsrv.config)&&JSON.stringify($ODMr(t,$ODsrv.config))!==JSON.stringify($ODlist.tools))$ODMW(t,$ODsrv.config,$ODlist.tools);return $ODlist})}';

const STALE_ENTRY_LOG = 'this.logger?.warn("MCP server already exists in hub state;';

export const mcpIdlePatches: readonly Patch[] = [
  {
    name: 'mcp-idle-helpers',
    find: 'class Ft{logger;catalog;clientInfo;getOAuthDriver;',
    replace: `${HELPERS}class Ft{logger;catalog;clientInfo;getOAuthDriver;`,
  },
  {
    name: 'mcp-idle-connect-server',
    find: 'async connectServer(t,r,h){',
    lookups: ['if(e.length>0||ri(n))await this.killServerProcessTree('],
    replace: `${ADD}${STATE}${ARM}${SLEEP}${WAKE}${USE}async $ODMspawn(t,r,h){`,
  },
  {
    name: 'mcp-idle-spawn-replaces-dormant-entry',
    find: `if(p){${STALE_ENTRY_LOG}`,
    replace: `if(p&&!p.$ODMz){${STALE_ENTRY_LOG}`,
  },
  {
    name: 'mcp-idle-request-tools',
    find: 'async requestToolsList(t){',
    replace: `${FETCH}async $ODMlist(t){`,
  },
  {
    name: 'mcp-idle-call-tool',
    find: 'async callTool(t,r,s,o="unknown-session",l="AGENT",u=void 0){',
    lookups: ['if(await QH(A.resolvers.promise,u),p=this.servers[t],!p)'],
    replace:
      'async callTool(...$ODargs){let $ODpend=!this.servers[$ODargs[0]]&&this.pendingConnections.get($ODargs[0]);' +
      'if($ODpend)await QH($ODpend.resolvers.promise,$ODargs[5]);' +
      'return await this.$ODMu($ODargs[0],()=>this.$ODMcall(...$ODargs))}' +
      'async $ODMcall(t,r,s,o="unknown-session",l="AGENT",u=void 0){',
  },
  {
    name: 'mcp-idle-read-resource',
    find: 'async readResource(t,r,{signal:',
    replace:
      'async readResource(...$ODargs){return await this.$ODMu($ODargs[0],()=>this.$ODMread(...$ODargs))}' +
      'async $ODMread(t,r,{signal:',
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

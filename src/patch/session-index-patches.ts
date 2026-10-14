import type { Patch } from './patches.ts';

export const PICKER_ROW_FACTOR = 4;

const QUERY_ROWS = `t.all(p.airgapEnabled?zn:\`\${zn} WHERE org_id IS NULL OR org_id = ?\`,p.airgapEnabled?[]:[p.activeOrganizationId??null]).map((m)=>st(i,m))`;

const AFTER_LIST = 'catch(m){if(_(m))o(m,"recover");throw m}},listSessionEntries(){try{let p=g();';

const CAPPED_ROWS =
  `$ODscope=p.airgapEnabled?" WHERE 1=1":" WHERE (org_id IS NULL OR org_id = ?)",` +
  '$ODbind=p.airgapEnabled?[]:[p.activeOrganizationId??null],' +
  `$ODbase=\`\${zn}\${$ODscope} AND messages_count > 0 AND (has_user_visible_messages IS NULL OR has_user_visible_messages != 0)\`,` +
  `$ODpicked=t.all(\`\${$ODbase} ORDER BY modified_time_ms DESC LIMIT ?\`,[...$ODbind,p.$ODcap.limit]);` +
  'if(p.$ODcap.cwd!==void 0){let $ODhave=new Set($ODpicked.map(($ODr)=>$ODr.session_id));' +
  `for(let $ODr of t.all(\`\${$ODbase} AND cwd = ?\`,[...$ODbind,p.$ODcap.cwd]))if(!$ODhave.has($ODr.session_id))$ODpicked.push($ODr)}` +
  '$ODlist=$ODpicked.map((m)=>st(i,m))';

export const sessionIndexPatches: readonly Patch[] = [
  {
    name: 'session-list-cache',
    find: `listSessions(p){try{return ${QUERY_ROWS}}${AFTER_LIST}`,
    replace:
      'listSessions(p){try{let $ODversion=g(),$ODkey=JSON.stringify([p.airgapEnabled===!0,p.activeOrganizationId??null,p.$ODcap??null]);' +
      'if(this.$ODrows?.version!==$ODversion)this.$ODrows={version:$ODversion,byKey:new Map};' +
      'let $ODhit=this.$ODrows.byKey.get($ODkey);if($ODhit!==void 0)return $ODhit;' +
      `let $ODlist;if(p.$ODcap){let ${CAPPED_ROWS}}else $ODlist=${QUERY_ROWS};` +
      `this.$ODrows.byKey.set($ODkey,$ODlist);return $ODlist}${AFTER_LIST}`,
  },
  {
    name: 'session-list-cap-request',
    find: 'async getSessionsForSelector(t){return await this.getAllNonEmptySessions({currentCwd:t,fetchOutsideCWD:!0,maxOtherSessions:eK,includeArchived:!0})}',
    replace: `async getSessionsForSelector(t){return await this.getAllNonEmptySessions({currentCwd:t,fetchOutsideCWD:!0,maxOtherSessions:eK,includeArchived:!0,$ODcap:eK*${PICKER_ROW_FACTOR}})}`,
  },
  {
    name: 'session-list-cap-options',
    find: 'async getAllSessions(t){let{currentCwd:o,fetchOutsideCWD:a=!1,maxOtherSessions:c,includeArchived:l=!1}=t||{},p={currentCwd:o,fetchOutsideCWD:a,includeArchived:l}',
    replace:
      'async getAllSessions(t){let{currentCwd:o,fetchOutsideCWD:a=!1,maxOtherSessions:c,includeArchived:l=!1}=t||{},p={currentCwd:o,fetchOutsideCWD:a,includeArchived:l,$ODcap:t?.$ODcap?{limit:t.$ODcap,cwd:o}:void 0}',
  },
  {
    name: 'session-list-cap-listing',
    find: 'async function hj(t,o){let a=performance.now(),c=await Xs(_a(t),a),u=ZI(t.sessionsDir),l=new Set(',
    replace:
      'async function hj(t,o){let a=performance.now(),c=await Xs(_a(t,o.$ODcap),a),u=ZI(t.sessionsDir),l=new Set(',
  },
  {
    name: 'session-list-cap-store',
    find: 'function _t(t){return async(i)=>{let r=await gt(i),o=await t.resolveVisibility(),u=i.listSessions({activeOrganizationId:o.activeOrganizationId,airgapEnabled:o.airgapEnabled===!0});',
    replace:
      'function _t(t,$ODcap){return async(i)=>{let r=await gt(i),o=await t.resolveVisibility(),u=i.listSessions({activeOrganizationId:o.activeOrganizationId,airgapEnabled:o.airgapEnabled===!0,$ODcap});',
  },
];

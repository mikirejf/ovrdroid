import type { Patch } from './patches.ts';

const QUERY_ROWS = `t.all(p.airgapEnabled?zn:\`\${zn} WHERE org_id IS NULL OR org_id = ?\`,p.airgapEnabled?[]:[p.activeOrganizationId??null]).map((m)=>st(i,m))`;

const AFTER_LIST = 'catch(m){if(_(m))o(m,"recover");throw m}},listSessionEntries(){try{let p=g();';

export const sessionIndexPatches: readonly Patch[] = [
  {
    name: 'session-index-only',
    find: 'function w0(){return Q(K.SessionIndexOnly)}',
    replace: 'function w0(){return!0}',
  },
  {
    name: 'session-list-cache',
    find: `listSessions(p){try{return ${QUERY_ROWS}}${AFTER_LIST}`,
    replace:
      'listSessions(p){try{let $ODkey=JSON.stringify([g(),p.airgapEnabled===!0,p.activeOrganizationId??null]);' +
      'if(this.$ODrows?.key===$ODkey)return this.$ODrows.rows;' +
      `let $ODlist=${QUERY_ROWS};this.$ODrows={key:$ODkey,rows:$ODlist};return $ODlist}${AFTER_LIST}`,
  },
];

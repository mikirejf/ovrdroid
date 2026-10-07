import { OVRDROID_UNDER_HOME } from '../paths.ts';
import type { Patch } from './patches.ts';

const UPDATE_FILE_NAME = 'update.json';

const UPDATE_FILE_WRITER_NAME = '$ODupdateWrite';

const UPDATE_FILE_READER_NAME = '$ODupdateRead';

const UPDATE_LOCAL = '$ODupdate';

const UPDATE_FILE_PATH = `require("os").homedir()+${JSON.stringify(`/${OVRDROID_UNDER_HOME}/${UPDATE_FILE_NAME}`)}`;

const UPDATE_FILE_WRITER =
  `function ${UPDATE_FILE_WRITER_NAME}($ODver){` +
  `try{let $ODfs=require("fs"),$ODpath=${UPDATE_FILE_PATH};` +
  'if($ODver===null)$ODfs.rmSync($ODpath,{force:!0});' +
  'else $ODfs.mkdirSync(require("path").dirname($ODpath),{recursive:!0}),$ODfs.writeFileSync($ODpath,JSON.stringify({version:$ODver}))}catch{}}';

const UPDATE_FILE_READER =
  `function ${UPDATE_FILE_READER_NAME}(){` +
  `try{let $ODver=JSON.parse(require("fs").readFileSync(${UPDATE_FILE_PATH},"utf8")).version;` +
  'return typeof $ODver==="string"&&$ODver!==Hs()?$ODver:null}catch{return null}}';

const UPDATE_HEADER_LINE =
  `if(${UPDATE_LOCAL}){` +
  `let $ODline="\\u2193 v"+${UPDATE_LOCAL}+" available \\xB7 run ovrdroid update";` +
  `b(f,L,M($ODline),$ODline,{color:o.warning,bold:!0}),L+=2}`;

export const updateNoticePatches: readonly Patch[] = [
  {
    name: 'auto-update-notice-only',
    find: 'if(!f)return l(u,"no-update"),"no-update";if(f.isRollback){',
    lookups: ['T("Rollback detected but rollbacks are disabled (CLI update service)",'],
    replace:
      `if(!f)return ${UPDATE_FILE_WRITER_NAME}(null),l(u,"no-update"),"no-update";` +
      `return ${UPDATE_FILE_WRITER_NAME}(f.version.version),` +
      'T("Auto-update blocked by ovrdroid; run ovrdroid update",{version:f.version.version}),' +
      'l(u,"skipped"),"skipped";if(f.isRollback){',
  },
  {
    name: 'update-notice-writer',
    find: 'var R=i({disableAutoUpdate:m().optional()});',
    replace: `${UPDATE_FILE_WRITER}var R=i({disableAutoUpdate:m().optional()});`,
  },
  {
    name: 'update-notice-reader',
    find: 'function $D({width:t,height:e,r}){',
    lookups: ['E=Hs(),C=!'],
    replace: `${UPDATE_FILE_READER}function $D({width:t,height:e,r}){`,
  },
  {
    name: 'update-notice-header-room',
    find: 'y=!oe().isProductionTier,E=Hs(),C=!d&&!!E,T=g.length+2+(y?1:0)+(C?2:0)+5,',
    replace:
      `y=!oe().isProductionTier,E=Hs(),C=!d&&!!E,${UPDATE_LOCAL}=${UPDATE_FILE_READER_NAME}(),` +
      `T=g.length+2+(y?1:0)+(C?2:0)+(${UPDATE_LOCAL}?2:0)+5,`,
  },
  {
    name: 'update-notice-header-line',
    find: 'b(f,L,M(q),q,l),L+=2;let Z=n("header.shortcutsLine1");',
    lookups: ['{color:o.headerLogo,bold:!0}'],
    replace: `${UPDATE_HEADER_LINE}b(f,L,M(q),q,l),L+=2;let Z=n("header.shortcutsLine1");`,
  },
];

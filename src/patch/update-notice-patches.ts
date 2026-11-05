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
  '$ODfs.mkdirSync(require("path").dirname($ODpath),{recursive:!0}),$ODfs.writeFileSync($ODpath,JSON.stringify({version:$ODver}))}catch{}}';

export const LATEST_RELEASE_URL = 'https://downloads.factory.ai/factory-cli/LATEST';

const RELEASE_CHECK_NAME = '$ODcheckRelease';

const RELEASE_CHECK =
  `function ${RELEASE_CHECK_NAME}(){` +
  `if(${RELEASE_CHECK_NAME}.ran)return;${RELEASE_CHECK_NAME}.ran=!0;` +
  `try{fetch(${JSON.stringify(LATEST_RELEASE_URL)},{signal:AbortSignal.timeout(15e3)}).then(($ODres)=>$ODres.ok?$ODres.text():"")` +
  `.then(($ODbody)=>{let $ODver=$ODbody.trim();if(/^[0-9]+(\\.[0-9]+){2}$/.test($ODver))${UPDATE_FILE_WRITER_NAME}($ODver)}).catch(()=>{})}catch{}}`;

const RELEASE_CHECK_SCHEDULE_NAME = '$ODscheduleCheck';

const RELEASE_CHECK_SCHEDULE =
  `function ${RELEASE_CHECK_SCHEDULE_NAME}($ODready){` +
  `Promise.resolve($ODready).then(()=>{if(globalThis.$ODpainted)${RELEASE_CHECK_NAME}();` +
  `else(globalThis.$ODafterPaint??=[]).push(${RELEASE_CHECK_NAME})}).catch(()=>{})}`;

const UPDATE_FILE_READER =
  `function ${UPDATE_FILE_READER_NAME}(){` +
  `try{let $ODver=JSON.parse(require("fs").readFileSync(${UPDATE_FILE_PATH},"utf8")).version;` +
  'return typeof $ODver==="string"&&$ODver!==e0()?$ODver:null}catch{return null}}';

const UPDATE_HEADER_LINE =
  `if(${UPDATE_LOCAL}){` +
  `let $ODline="\\u2193 v"+${UPDATE_LOCAL}+" available \\xB7 run ovrdroid update";` +
  `b(f,L,M($ODline),$ODline,{color:o.warning,bold:!0}),L+=2}`;

export const updateNoticePatches: readonly Patch[] = [
  {
    name: 'auto-update-off',
    find: 'downloadsPrefix:"",autoUpdateEnabled:!0,airgapEnabled:!1',
    replace: 'downloadsPrefix:"",autoUpdateEnabled:!1,airgapEnabled:!1',
  },
  {
    name: 'release-check-after-paint',
    find: 'function gde(t){if(!D)D=LI(',
    replace:
      `${UPDATE_FILE_WRITER}${RELEASE_CHECK}${RELEASE_CHECK_SCHEDULE}` +
      `function gde(t){${RELEASE_CHECK_SCHEDULE_NAME}(t);if(!D)D=LI(`,
  },
  {
    name: 'update-notice-reader',
    find: 'function u5({width:e,height:n,t}){',
    lookups: ['v=e0(),A=!'],
    replace: `${UPDATE_FILE_READER}function u5({width:e,height:n,t}){`,
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

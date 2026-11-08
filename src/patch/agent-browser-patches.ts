import type { Patch } from './patches.ts';

export const AGENT_BROWSER_NPM_INSTALL = 'npm i -g agent-browser && agent-browser install';
export const AGENT_BROWSER_BREW_INSTALL = 'brew install agent-browser';

export const AGENT_BROWSER_MISSING_MESSAGE =
  'agent-browser is not installed on this machine, and Droid no longer bundles it. ' +
  `Ask the user to install it with \`${AGENT_BROWSER_NPM_INSTALL}\` (or \`${AGENT_BROWSER_BREW_INSTALL}\`), then run the command again.`;

const FINDER =
  'function $ODabDir($ODpath,$ODskip){let $ODfs=require("fs"),$ODpa=require("path");' +
  'for(let $ODdir of $ODpath.split($ODpa.delimiter)){if(!$ODdir||$ODdir===$ODskip)continue;' +
  'try{let $ODfile=$ODpa.join($ODdir,"agent-browser");' +
  'if($ODfs.statSync($ODfile).isFile()){$ODfs.accessSync($ODfile,$ODfs.constants.X_OK);return $ODdir}}catch{}}}';

const RESOLVER =
  `${FINDER}function $ODabPath($ODpath,$ODskip){let $ODdir=$ODabDir($ODpath,$ODskip);` +
  `if($ODdir===void 0)throw Error(${JSON.stringify(AGENT_BROWSER_MISSING_MESSAGE)});` +
  'return $ODdir+require("path").delimiter+$ODpath}';

const INSPECT_BINARY =
  'function CUe(){let{binaryPath:a,skillDataDir:t}=oe();if(!h(a))return{state:"missing",path:a};return{state:Re(a,t)?"stale":"current",path:a}}';

const DOCTOR_NOT_EXTRACTED = 'n=o("skip","not extracted yet",{path:t.path,copy:t.state});';

const DOCTOR_NOT_INSTALLED = `not installed: ${AGENT_BROWSER_NPM_INSTALL} (or ${AGENT_BROWSER_BREW_INSTALL})`;

const EXECUTE_PATH_MERGE = 'if(_.length>0)y[C]=[..._,...b?[b]:[]].join(lt.delimiter);await Yte(y);';

export const agentBrowserPatches: readonly Patch[] = [
  {
    name: 'agent-browser-execute-resolver',
    find: 'class Et{static isAgentBrowserInvocation(t){',
    replace: `${RESOLVER}class Et{static isAgentBrowserInvocation(t){`,
  },
  {
    name: 'agent-browser-execute-no-bundled-copy',
    find: 'if(Et.isAgentBrowserInvocation(t))l("[Tool] Detected agent-browser invocation, ensuring installed"),await wN(),y.AGENT_BROWSER_SKILLS_DIR=xN();y=jz(y,p,c??[])',
    replace: 'y=jz(y,p,c??[])',
  },
  {
    name: 'agent-browser-execute-system-binary',
    find: EXECUTE_PATH_MERGE,
    lookups: [
      'S=lt.join(Q(),G(),"bin"),E=[S],T=fw(t)?E_()??e2():void 0;',
      'if(Et.isAgentBrowserInvocation(t))l("[Tool] Detected agent-browser invocation',
    ],
    replace: `${EXECUTE_PATH_MERGE.slice(0, -'await Yte(y);'.length)}if(Et.isAgentBrowserInvocation(t))y[C]=$ODabPath(y[C],S);await Yte(y);`,
  },
  {
    name: 'agent-browser-terminal-resolver',
    find: 'class Vn{terminals=new Map;',
    replace: `${RESOLVER}class Vn{terminals=new Map;`,
  },
  {
    name: 'agent-browser-terminal-system-binary',
    find: 'if(r[u]=[...a.filter((c)=>!d.split(g.delimiter).includes(c)),d].join(g.delimiter),Dz(e.command))await wN(),r.AGENT_BROWSER_SKILLS_DIR=xN();',
    lookups: [
      'let s=g.join(Q(),G(),"bin"),o=fw(e.command)?E_()??e2():void 0,a=o?[g.dirname(o),s]:[s]',
    ],
    replace:
      'r[u]=[...a.filter((c)=>!d.split(g.delimiter).includes(c)),d].join(g.delimiter);if(Dz(e.command))r[u]=$ODabPath(r[u],s);',
  },
  {
    name: 'agent-browser-doctor-system-binary',
    find: INSPECT_BINARY,
    replace:
      `${FINDER}function CUe(){let{binaryPath:a}=oe(),$ODdir=$ODabDir(process.env.PATH??"",require("path").dirname(a));` +
      'return $ODdir===void 0?{state:"missing",path:a}:{state:"current",path:require("path").join($ODdir,"agent-browser")}}',
  },
  {
    name: 'agent-browser-doctor-not-installed',
    find: DOCTOR_NOT_EXTRACTED,
    lookups: ['f=(l)=>{let s=S[l],o=(t,a,n)=>({category:"binaries"'],
    replace: `n=l==="agent-browser"?o("warn",${JSON.stringify(DOCTOR_NOT_INSTALLED)},{path:t.path,copy:t.state}):o("skip","not extracted yet",{path:t.path,copy:t.state});`,
  },
  {
    name: 'agent-browser-bundled-files-removed',
    find: 'var q="/$bunfs/root/agent-browser-',
    until: 'embeddedPath:V}];',
    lookups: ['.digest("hex")!==Y}', 'for(let s of ee){'],
    replace: 'var Y="",ee=[];',
  },
];

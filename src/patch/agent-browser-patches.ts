import type { Patch } from './patches.ts';

export const AGENT_BROWSER_NPM_INSTALL = 'npm i -g agent-browser && agent-browser install';
export const AGENT_BROWSER_BREW_INSTALL = 'brew install agent-browser';

export const AGENT_BROWSER_MISSING_MESSAGE =
  'agent-browser is not installed on this machine, and Droid no longer bundles it. ' +
  `Ask the user to install it with \`${AGENT_BROWSER_NPM_INSTALL}\` (or \`${AGENT_BROWSER_BREW_INSTALL}\`), then run the command again.`;

const RESOLVER =
  'function $ODabPath($ODpath,$ODskip){let $ODfs=require("fs"),$ODpa=require("path");' +
  'for(let $ODdir of $ODpath.split($ODpa.delimiter)){if(!$ODdir||$ODdir===$ODskip)continue;' +
  'try{let $ODfile=$ODpa.join($ODdir,"agent-browser");' +
  'if($ODfs.statSync($ODfile).isFile()){$ODfs.accessSync($ODfile,$ODfs.constants.X_OK);return $ODdir+$ODpa.delimiter+$ODpath}}catch{}}' +
  `throw Error(${JSON.stringify(AGENT_BROWSER_MISSING_MESSAGE)})}`;

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
    name: 'agent-browser-bundled-files-removed',
    find: 'var q="/$bunfs/root/agent-browser-',
    until: 'embeddedPath:V}];',
    lookups: ['.digest("hex")!==Y}', 'for(let s of ee){'],
    replace: 'var Y="",ee=[];',
  },
];

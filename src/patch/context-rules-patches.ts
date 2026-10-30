import type { Patch } from './patches.ts';

export const TRANSCRIPTS_GLOBAL = '__odTranscripts';

export const ALWAYS_APPLY =
  String.raw`function $ODalways($ODtext){let $ODs=$ODtext.replace(/^\uFEFF/,""),$ODm=/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec($ODs);` +
  String.raw`if(!$ODm||!/^alwaysApply:[ \t]*true[ \t]*(?:#.*)?$/m.test($ODm[1]))return;return $ODs.slice($ODm[0].length).trim()||void 0}`;

export const RULES_LOADER =
  'async function $ODrules($ODstart){let $ODhome=K.resolve(Q.homedir()),$ODproject=K.resolve(En($ODstart)||$ODstart),$ODfound=[];' +
  'for(let[$ODroot,$ODpersonal]of[[$ODproject,!1],[$ODhome,!0]]){if(!$ODpersonal&&$ODroot===$ODhome)continue;' +
  'let $ODdir=K.join($ODroot,".cursor","rules"),$ODnames;' +
  'try{$ODnames=(await tt.promises.readdir($ODdir)).filter(($ODname)=>$ODname.endsWith(".mdc")).sort()}catch{continue}' +
  'for(let $ODname of $ODnames){try{let $ODfile=K.join($ODdir,$ODname),$ODbody=$ODalways(await tt.promises.readFile($ODfile,"utf8"));' +
  'if($ODbody)$ODfound.push({filePath:$ODfile,fileName:$ODname,content:$ODbody,isPersonal:$ODpersonal,odCmd:$ODpersonal?"~/.cursor/rules/"+$ODname:void 0})}catch{}}}' +
  'return $ODfound}';

export const TRANSCRIPTS_LINE =
  `(()=>{try{let $ODdir=M&&globalThis.${TRANSCRIPTS_GLOBAL}?.(M);` +
  'return $ODdir?"Agent transcripts for this project: "+$ODdir+"/ (one <session-id>.jsonl per session)":""}catch{return""}})()';

export const contextRulesPatches: readonly Patch[] = [
  {
    name: 'cursor-rules-join-agents-md',
    find: 'async function Y(e){let{guidelines:t,skipped:n}=await $fe({startPath:e}),i=x(n),s=n.map(',
    lookups: [
      'import tt from"fs";import Q from"os"',
      'import K from"path";import*as w from"fs"',
      'this.gitRoot=En(this.cwd),this.homeDir=',
    ],
    replace: `${ALWAYS_APPLY}${RULES_LOADER}async function Y(e){let{guidelines:$ODstock,skipped:n}=await $fe({startPath:e}),t=[...$ODstock,...await $ODrules(e)],i=x(n),s=n.map(`,
  },
  {
    name: 'cursor-rules-show-home-path',
    find: 'function z(e){if(!e.isPersonal)return e.filePath;return',
    replace: 'function z(e){if(e.odCmd)return e.odCmd;if(!e.isPersonal)return e.filePath;return',
  },
  {
    name: 'cursor-rules-count-as-personal',
    find: `function J(e){return Ite().some((t)=>e.cmd.includes(\`~/\${t}/\`))}`,
    replace: `function J(e){return Ite().some((t)=>e.cmd.includes(\`~/\${t}/\`))||e.cmd.startsWith("cat ~/.cursor/rules/")}`,
  },
  {
    name: 'transcripts-line-in-system-info',
    find: 'M=e.directoryInfo?.find((y)=>y.cmd==="pwd")?.out,B=M?Lhe(M):""',
    replace: `M=e.directoryInfo?.find((y)=>y.cmd==="pwd")?.out,B=[M?Lhe(M):"",${TRANSCRIPTS_LINE}].filter(Boolean).join("\\n")`,
  },
  {
    name: 'transcripts-folder-lookup',
    find: 'constructor(){this.sessionsDir=sn.join(L(),w(),"sessions"),this.ensureSessionsDirectory(),',
    replace: `constructor(){this.sessionsDir=sn.join(L(),w(),"sessions"),globalThis.${TRANSCRIPTS_GLOBAL}=($ODcwd)=>this.getSessionsDirectory($ODcwd),this.ensureSessionsDirectory(),`,
  },
];

import type { Patch } from './patches.ts';

export const MAX_WIDTH_ENV = 'OVRDROID_MAX_WIDTH';
export const DEFAULT_MAX_WIDTH = 140;
export const MIN_MAX_WIDTH = 60;
export const WIDTH_COMMAND = 'width';
export const WIDTH_USAGE = `Usage: /${WIDTH_COMMAND} [on|off|<columns>]`;
export const CONFIG_FILE = 'ovrdroid.json';
export const SAVED_WIDTH_KEY = 'maxWidth';
export const SAVED_LAST_WIDTH_KEY = 'lastMaxWidth';

const COMMAND_DESCRIPTION = 'Center the chat in a wide terminal (on, off, or a column count)';

export const WIDE_TERMINAL_HELPERS =
  `var $ODclamp=($ODn)=>$ODn>0?Math.max($ODn,${MIN_MAX_WIDTH}):0,` +
  '$ODwidthOf=($ODvalue)=>typeof $ODvalue==="number"&&Number.isFinite($ODvalue)&&$ODvalue>=0?$ODclamp($ODvalue):void 0,' +
  '$ODdir=(process.env.FACTORY_HOME_OVERRIDE||require("os").homedir())+"/.factory",' +
  `$ODfile=$ODdir+"/${CONFIG_FILE}",` +
  '$ODload=()=>{try{let $ODjson=JSON.parse(require("fs").readFileSync($ODfile,"utf8"));' +
  'return $ODjson&&typeof $ODjson==="object"&&!Array.isArray($ODjson)?$ODjson:{}}catch{return{}}},' +
  `$ODconfig=$ODload(),$ODenv=process.env.${MAX_WIDTH_ENV},` +
  `$ODmaxWidth=$ODenv?$ODclamp(Number($ODenv)):$ODwidthOf($ODconfig.${SAVED_WIDTH_KEY})??${DEFAULT_MAX_WIDTH},` +
  `$ODlastWidth=$ODmaxWidth||$ODwidthOf($ODconfig.${SAVED_LAST_WIDTH_KEY})||${DEFAULT_MAX_WIDTH};` +
  'function $ODboxWidth($ODcols){return $ODmaxWidth>0&&$ODcols>$ODmaxWidth?$ODmaxWidth:$ODcols}' +
  'function $ODsave(){let $ODfs=require("fs"),$ODtmp=$ODfile+"."+process.pid+".tmp";' +
  'try{$ODfs.mkdirSync($ODdir,{recursive:!0});' +
  `$ODfs.writeFileSync($ODtmp,JSON.stringify({...$ODload(),${SAVED_WIDTH_KEY}:$ODmaxWidth,${SAVED_LAST_WIDTH_KEY}:$ODlastWidth},null,2)+"\\n");` +
  '$ODfs.renameSync($ODtmp,$ODfile)}' +
  'catch($ODerr){try{$ODfs.rmSync($ODtmp,{force:!0})}catch{}return $ODerr.message}}' +
  'function $ODsetWidth($ODarg){let $ODword=$ODarg?.toLowerCase(),$ODnum=Number($ODarg);' +
  'if($ODarg===void 0)$ODmaxWidth=$ODmaxWidth>0?0:$ODlastWidth;' +
  'else if($ODword==="on")$ODmaxWidth=$ODlastWidth;' +
  'else if($ODword==="off")$ODmaxWidth=0;' +
  'else if($ODnum>0)$ODmaxWidth=$ODclamp($ODnum);' +
  `else return ${JSON.stringify(WIDTH_USAGE)};` +
  'if($ODmaxWidth>0)$ODlastWidth=$ODmaxWidth;' +
  'let $ODfailure=$ODsave();' +
  'process.stdout.emit("resize");' +
  'return($ODmaxWidth>0?"Centered layout on, max width "+$ODmaxWidth+" columns":"Centered layout off")' +
  '+($ODfailure===void 0?"":" (could not save: "+$ODfailure+")")}' +
  'function $ODcenterText($ODtext){let $ODcols=process.stdout.columns||80,$ODpad=$ODcols-$ODboxWidth($ODcols)>>1;' +
  'return $ODpad&&$ODtext?$ODtext.replace(/^(?=.)/gm," ".repeat($ODpad)):$ODtext}' +
  'globalThis.__odBoxWidth=$ODboxWidth;globalThis.__odSetWidth=$ODsetWidth;globalThis.__odCenterText=$ODcenterText;';

const COMMAND =
  `${WIDTH_COMMAND}:Gc({name:${JSON.stringify(WIDTH_COMMAND)},description:${JSON.stringify(COMMAND_DESCRIPTION)},` +
  'execute:($ODargs,$ODctx)=>{$ODctx.addEphemeralSystemMessage(globalThis.__odSetWidth($ODargs[0]),' +
  '{messageType:"system_notification",visibility:"user_only"});return{handled:!0}}}),';

export const wideTerminalPatches: readonly Patch[] = [
  {
    name: 'wide-terminal-helpers',
    find: 'var{runCli:',
    replace: `${WIDE_TERMINAL_HELPERS}var{runCli:`,
  },
  {
    name: 'wide-terminal-layout-width',
    find: 'calculateLayout=()=>{let t=this.getTerminalWidth();this.rootNode.yogaNode.setWidth(t)',
    replace:
      'calculateLayout=()=>{let t=this.getTerminalWidth();this.rootNode.yogaNode.setWidth(globalThis.__odBoxWidth(t))',
  },
  {
    name: 'wide-terminal-size-hook',
    find: `function X9(d){let f=dE(d.columns,iy),E=dE(d.rows,Gy);return\`\${f}x\${E}\`}`,
    replace: `function X9(d){let f=globalThis.__odBoxWidth(dE(d.columns,iy)),E=dE(d.rows,Gy);return\`\${f}x\${E}x\${d.columns}\`}`,
  },
  {
    name: 'wide-terminal-tool-line-width',
    find: 'C=(process.stdout.columns||80)-Cae;',
    replace: 'C=globalThis.__odBoxWidth(process.stdout.columns||80)-Cae;',
  },
  {
    name: 'wide-terminal-resize-watch-start',
    find: 'z=d.columns,q=!1,Z=()=>{',
    replace: 'z=d.columns,$ODcapped=globalThis.__odBoxWidth(d.columns),q=!1,Z=()=>{',
  },
  {
    name: 'wide-terminal-resize-watch-compare',
    find: 'if(d.columns!==z)z=d.columns,q=!0;',
    replace:
      'let $ODwidth=globalThis.__odBoxWidth(d.columns);if(d.columns!==z||$ODwidth!==$ODcapped)z=d.columns,$ODcapped=$ODwidth,q=!0;',
  },
  {
    name: 'wide-terminal-center-frame',
    find: 'ep(this.rootNode,this.isScreenReaderEnabled)',
    replace:
      '(($ODframe)=>({...$ODframe,output:globalThis.__odCenterText($ODframe.output),staticOutput:globalThis.__odCenterText($ODframe.staticOutput)}))(ep(this.rootNode,this.isScreenReaderEnabled))',
  },
  {
    name: 'wide-terminal-early-shell-paint',
    find: `width:Math.max(1,r.columns??80),height:Math.max(1,r.rows??36),tuiDebug:g?.tuiDebug,windowsLike:F}),t=u?L1(s):\`\${Me.HIDE_CURSOR}\\x1B[J\`;r.write(\`\${t}\${e.output}\`)`,
    replace: `width:globalThis.__odBoxWidth(Math.max(1,r.columns??80)),height:Math.max(1,r.rows??36),tuiDebug:g?.tuiDebug,windowsLike:F}),t=u?L1(s):\`\${Me.HIDE_CURSOR}\\x1B[J\`;r.write(\`\${t}\${globalThis.__odCenterText(e.output)}\`)`,
  },
  {
    name: 'wide-terminal-early-shell-composer',
    find: `width:Math.max(1,r.columns??80),windowsLike:F}),t=Math.max(0,s-R-S);r.write(\`\${L1(s-R)}\${Rj(e,!0)}`,
    replace: `width:globalThis.__odBoxWidth(Math.max(1,r.columns??80)),windowsLike:F}),t=Math.max(0,s-R-S);r.write(\`\${L1(s-R)}\${globalThis.__odCenterText(Rj(e,!0))}`,
  },
  {
    name: 'wide-terminal-command-catalog',
    find: 'vim:{name:"vim",description:"Toggle vim keybindings for the chat input",category:"config"}}',
    replace: `vim:{name:"vim",description:"Toggle vim keybindings for the chat input",category:"config"},${WIDTH_COMMAND}:{name:${JSON.stringify(WIDTH_COMMAND)},description:${JSON.stringify(COMMAND_DESCRIPTION)},category:"config"}}`,
  },
  {
    name: 'wide-terminal-command',
    find: 'vim:Cs,commands:Me()},_s={',
    lookups: ['Cs=Gc({name:"vim"'],
    replace: `vim:Cs,${COMMAND}commands:Me()},_s={`,
  },
  {
    name: 'wide-terminal-command-busy',
    find: 'terminal-setup":"immediate",themes:"immediate",vim:"immediate"};',
    replace: `terminal-setup":"immediate",themes:"immediate",vim:"immediate",${WIDTH_COMMAND}:"immediate"};`,
  },
];

import type { Patch } from './patches.ts';

export const WATCH_VARIABLE = 'OD_WATCH';

const OPEN =
  `globalThis.__owd??=((F)=>{let fd=process.env.${WATCH_VARIABLE}?F.openSync(process.env.${WATCH_VARIABLE},"a"):0;` +
  'return(m)=>{if(fd)F.writeSync(fd,performance.now().toFixed(0)+"\\t"+m+"\\n")}})(require("fs"));';

export const watchPatches: readonly Patch[] = [
  {
    name: 'watch-fsevent',
    find: 'let T=A5.watch(this.folderPath,{recursive:!0,persistent:!0},(R,H)=>{if(!H){this.scheduleChange();return}let A=typeof H==="string"?H:H.toString("utf8");',
    replace:
      'let T=A5.watch(this.folderPath,{recursive:!0,persistent:!0},(R,H)=>{if(!H){this.scheduleChange();return}let A=typeof H==="string"?H:H.toString("utf8");' +
      `${OPEN}__owd("fsevent\\t"+(this.isRelevantChange(A)?"relevant":"ignored")+"\\t"+A);`,
  },
  {
    name: 'watch-settings-schedule',
    find: 'scheduleChange(){if(!this.isWatching)return;if(this.debounceTimer)clearTimeout(this.debounceTimer);this.debounceTimer=setTimeout(()=>{',
    replace:
      `scheduleChange(){if(!this.isWatching)return;${OPEN}__owd("schedule\\tsettings\\t"+this.folderPath);` +
      'if(this.debounceTimer)clearTimeout(this.debounceTimer);this.debounceTimer=setTimeout(()=>{',
  },
  {
    name: 'watch-agent-schedule',
    find: 'scheduleChange(){if(this.debounceTimer)clearTimeout(this.debounceTimer);this.debounceTimer=setTimeout(()=>{this.debounceTimer=null,this.emit("change",{folderPath:this.folderPath})},cwn)}',
    replace:
      `scheduleChange(){${OPEN}__owd("schedule\\tagent\\t"+this.folderPath);` +
      'if(this.debounceTimer)clearTimeout(this.debounceTimer);this.debounceTimer=setTimeout(()=>{this.debounceTimer=null,this.emit("change",{folderPath:this.folderPath})},cwn)}',
  },
  {
    name: 'watch-catalog-status',
    find: 'if(omR.status===T.status&&omR.skillsCount===T.skillsCount&&bvf(omR.commands,T.commands))return!1;',
    replace:
      `${OPEN}if(omR.status!==T.status)__owd("status\\t"+omR.status+"->"+T.status+"\\t"+omR.commands.length+" commands");` +
      'if(omR.status===T.status&&omR.skillsCount===T.skillsCount&&bvf(omR.commands,T.commands))return!1;',
  },
  {
    name: 'watch-catalog-write',
    find: 'try{await $GT.mkdir(L,{recursive:!0}),await Promise.all([$GT.writeFile($,t,{encoding:"utf8",mode:384,flag:"wx"}),',
    replace:
      `try{${OPEN}__owd("cache-write\\t"+A);` +
      'await $GT.mkdir(L,{recursive:!0}),await Promise.all([$GT.writeFile($,t,{encoding:"utf8",mode:384,flag:"wx"}),',
  },
];

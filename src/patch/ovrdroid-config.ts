export const CONFIG_FILE = 'ovrdroid.json';

const FACTORY_DIR = '(process.env.FACTORY_HOME_OVERRIDE||require("os").homedir())+"/.factory"';

export const CONFIG_PATHS = `$ODdir=${FACTORY_DIR},$ODfile=$ODdir+"/${CONFIG_FILE}"`;

export const CONFIG_LOAD =
  '$ODload=()=>{try{let $ODjson=JSON.parse(require("fs").readFileSync($ODfile,"utf8"));' +
  'return $ODjson&&typeof $ODjson==="object"&&!Array.isArray($ODjson)?$ODjson:{}}catch{return{}}}';

export function configSave(entries: string): string {
  return (
    'function $ODsave(){let $ODfs=require("fs"),$ODtmp=$ODfile+"."+process.pid+".tmp";' +
    'try{$ODfs.mkdirSync($ODdir,{recursive:!0});' +
    `$ODfs.writeFileSync($ODtmp,JSON.stringify({...$ODload(),${entries}},null,2)+"\\n");` +
    '$ODfs.renameSync($ODtmp,$ODfile)}' +
    'catch($ODerr){try{$ODfs.rmSync($ODtmp,{force:!0})}catch{}return $ODerr.message}}'
  );
}

import type { Patch } from './patches.ts';

export const BODIES_VARIABLE = 'OD_BODIES';

const RECORD = `(globalThis.__odBody??=($ODsid,$ODmid,$ODroute,$ODbody)=>{try{let $ODfile=process.env.${BODIES_VARIABLE};if($ODfile)require("fs").appendFileSync($ODfile,JSON.stringify({t:Date.now(),sessionId:$ODsid,assistantMessageId:$ODmid,route:$ODroute,body:$ODbody})+"\\n")}catch{}})`;

export const bodyPatches: readonly Patch[] = [
  {
    name: 'bodies-recorder',
    find: 'recordOutgoingRequest({sessionId:s,assistantMessageId:o,providerPath:r,modelId:c,apiProvider:l,request:f}){try{',
    replace: `recordOutgoingRequest({sessionId:s,assistantMessageId:o,providerPath:r,modelId:c,apiProvider:l,request:f}){${RECORD}(s,o,r,f);try{`,
  },
];

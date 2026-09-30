import type { Patch } from './patches.ts';

export const BODIES_VARIABLE = 'OD_BODIES';

const RECORD = `(globalThis.__odBody??=($ODsid,$ODmid,$ODroute,$ODvia,$ODbody)=>{try{let $ODfile=process.env.${BODIES_VARIABLE};if($ODfile)require("fs").appendFileSync($ODfile,JSON.stringify({t:Date.now(),sessionId:$ODsid,assistantMessageId:$ODmid,route:$ODroute,transport:$ODvia,body:$ODbody})+"\\n")}catch{}})`;

const RESPONSES_REQUEST =
  'l.recordOutgoingRequest({sessionId:Se,assistantMessageId:De,providerPath:"openai_responses",';

export const bodyPatches: readonly Patch[] = [
  {
    name: 'bodies-recorder',
    find: 'recordOutgoingRequest({sessionId:s,assistantMessageId:o,providerPath:r,modelId:c,apiProvider:l,request:f}){try{',
    replace: `recordOutgoingRequest({sessionId:s,assistantMessageId:o,providerPath:r,modelId:c,apiProvider:l,request:f}){if(r!=="openai_responses")${RECORD}(s,o,r,"http",f);try{`,
  },
  {
    name: 'bodies-responses-http',
    find: 'let pn=await ps.responses.create(Xs,{signal:ln.signal,',
    lookups: [RESPONSES_REQUEST],
    replace: `${RECORD}(Se,De,"openai_responses","http",Xs);let pn=await ps.responses.create(Xs,{signal:ln.signal,`,
  },
  {
    name: 'bodies-responses-ws-session',
    find: 'Jn.runTurn(Xs,{signal:ln.signal,assistantMessageId:De,',
    lookups: [RESPONSES_REQUEST],
    replace: 'Jn.runTurn(Xs,{odSession:Se,signal:ln.signal,assistantMessageId:De,',
  },
  {
    name: 'bodies-responses-ws',
    find: 'try{try{o.send(JSON.stringify(j))}catch(',
    lookups: ['async runTurn(t,s){if(this.disabled)'],
    replace: `try{try{${RECORD}(s.odSession,s.assistantMessageId,"openai_responses","ws",j),o.send(JSON.stringify(j))}catch(`,
  },
];

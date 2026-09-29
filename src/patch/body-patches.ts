import type { Patch } from './patches.ts';

export const BODIES_VARIABLE = 'OD_BODIES';

const RECORD = `(globalThis.__odBody??=(s,a,r,x,b)=>{try{let f=process.env.${BODIES_VARIABLE};if(f)require("fs").appendFileSync(f,JSON.stringify({t:Date.now(),sessionId:s,assistantMessageId:a,route:r,transport:x,body:b})+"\\n")}catch{}})`;

export const bodyPatches: readonly Patch[] = [
  {
    name: 'bodies-recorder',
    find: 'recordOutgoingRequest({sessionId:s,assistantMessageId:o,providerPath:r,modelId:c,apiProvider:l,request:f}){try{',
    replace: `recordOutgoingRequest({sessionId:s,assistantMessageId:o,providerPath:r,modelId:c,apiProvider:l,request:f}){if(r!=="openai_responses")${RECORD}(s,o,r,"http",f);try{`,
  },
  {
    name: 'bodies-responses-http',
    find: 'let pn=await ps.responses.create(Xs,{signal:ln.signal,',
    replace: `${RECORD}(Se,De,"openai_responses","http",Xs);let pn=await ps.responses.create(Xs,{signal:ln.signal,`,
  },
  {
    name: 'bodies-responses-ws-session',
    find: 'Jn.runTurn(Xs,{signal:ln.signal,assistantMessageId:De,',
    replace: 'Jn.runTurn(Xs,{odSession:Se,signal:ln.signal,assistantMessageId:De,',
  },
  {
    name: 'bodies-responses-ws',
    find: 'o.send(JSON.stringify(j))',
    replace: `${RECORD}(s.odSession,s.assistantMessageId,"openai_responses","ws",j),o.send(JSON.stringify(j))`,
  },
];

import type { Patch } from './patches.ts';

const NOTIFICATION_OPEN = '<system-notification>';
const NOTIFICATION_CLOSE = '</system-notification>';

const CARRIED_LEAD = 'The user invoked the following skill earlier in this session by typing /';
const CARRIED_TAIL = ' in a message. Its instructions still apply.';

export function carriedLead(name: string): string {
  return `${CARRIED_LEAD}${name}${CARRIED_TAIL}`;
}

export function carriedSkill(name: string, block: string): string {
  return `${NOTIFICATION_OPEN}\n${carriedLead(name)}\n${block}\n${NOTIFICATION_CLOSE}`;
}

const TYPED_SKILL = String.raw`/<system-notification>\n[^\n]*by typing \/[^\n]*\n(<skill\s[^>]*>\n<name>([^<]+)<\/name>[\s\S]*?\n<\/skill>)\n<\/system-notification>/g`;

const IS_CARRIED = `($ODentry)=>$ODentry.startsWith(${JSON.stringify(NOTIFICATION_OPEN)})`;

const COLLECT =
  'let $ODcarried=new Map,' +
  `$ODscan=($ODtext)=>{for(let $ODhit of $ODtext.matchAll(${TYPED_SKILL}))` +
  `$ODcarried.set($ODhit[2],${JSON.stringify(`${NOTIFICATION_OPEN}\n${CARRIED_LEAD}`)}+$ODhit[2]+` +
  `${JSON.stringify(`${CARRIED_TAIL}\n`)}+$ODhit[1]+${JSON.stringify(`\n${NOTIFICATION_CLOSE}`)})};` +
  'for(let $ODold of[...t?.retainedSkills??[]].reverse())$ODscan($ODold);' +
  'for(let $ODmsg of e.messages)if($ODmsg.role==="user"&&Array.isArray($ODmsg.content))' +
  'for(let $ODblock of $ODmsg.content)if($ODblock.type==="text"&&$ODblock.text)$ODscan($ODblock.text);';

const ENTRY_NAME = String.raw`/<name>([^<]+)<\/name>/.exec($ODentry)?.[1]`;

const STOCK_RETAINED_NAMES = 'Et([...c.reverse(),...o])';

export const skillCarryPatches: readonly Patch[] = [
  {
    name: 'compaction-keeps-typed-skill-text',
    find: `.map((u)=>u.name);return ${STOCK_RETAINED_NAMES}.slice(0,_o)}`,
    lookups: ['function zo(e){let{previous:t}=e,o=t?.retainedSkills??'],
    replace:
      `.map((u)=>u.name);${COLLECT}` +
      `let $ODisCarried=${IS_CARRIED};` +
      `return[...[...$ODcarried.values()].reverse(),...${STOCK_RETAINED_NAMES}.filter(($ODentry)=>!$ODisCarried($ODentry)).slice(0,_o)]}`,
  },
  {
    name: 'compaction-note-shows-typed-skill-text',
    find: 'let t=e?.retainedSkills??[],o=[],n=e?.retainedSpec?nn(e.retainedSpec):void 0;if(n)o.push(n);if(t.length>0)o.push(',
    replace:
      `let $ODall=e?.retainedSkills??[],$ODisCarried=${IS_CARRIED},$ODcarried=$ODall.filter($ODisCarried),` +
      't=$ODall.filter(($ODentry)=>!$ODisCarried($ODentry)&&' +
      '!$ODcarried.some(($ODtext)=>$ODtext.includes("<name>"+$ODentry+"</name>"))),' +
      'o=[],n=e?.retainedSpec?nn(e.retainedSpec):void 0;if(n)o.push(n);o.push(...$ODcarried);if(t.length>0)o.push(',
  },
  {
    name: 'compaction-leaves-out-skills-typed-in-kept-messages',
    find: 'ee=se(ee);let no=Xe({text:ee,systemInfo:c,...L}),ct=du(ee),so=p.slice(b)',
    replace:
      'ee=se(ee);{let $ODtyped=new Set;' +
      'for(let $ODmsg of p.slice(b))if($ODmsg.role==="user"&&Array.isArray($ODmsg.content))' +
      'for(let $ODblock of $ODmsg.content)if($ODblock.type==="text"&&$ODblock.text)' +
      `for(let $ODhit of $ODblock.text.matchAll(${TYPED_SKILL}))$ODtyped.add($ODhit[2]);` +
      `let $ODisCarried=${IS_CARRIED};` +
      'if($ODtyped.size>0)L={...L,retainedSkills:L.retainedSkills.filter(($ODentry)=>' +
      `!$ODtyped.has($ODisCarried($ODentry)?${ENTRY_NAME}:$ODentry))}}` +
      'let no=Xe({text:ee,systemInfo:c,...L}),ct=du(ee),so=p.slice(b)',
  },
];

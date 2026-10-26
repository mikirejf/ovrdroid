import type { Patch } from './patches.ts';

export const STALE_EDIT_NOTE =
  'This file had changed since you last read it. The text you replaced still matched exactly once, so the edit went onto the current contents. Read the file before relying on any other part of it.';

const TOLERATE_PARAMETER = 'async function VU(t,o){if(!t||typeof t!=="string")return{success:!1,';

const REFUSAL_HEAD = 'if(await KR().hasFileChangedExternally(a.absolutePath))return{success:!1,';

const EDIT_CHECKS =
  'let p=await VU(o,u);if(!p.success)return{success:!1,message:p.message,filePath:o};' +
  'let g=await hO(o);if(g.error)return{success:!1,message:g.error,filePath:o};' +
  'let y=g.content,S={old_str:a,new_str:l,change_all:c},T=dt(y),b=Wse(T,S);';

const EDIT_RESULT = 'changesApplied:b.changesApplied,diffLines:k.diffLines}}catch(p)';

const EDIT_REPLY_HEAD =
  '{diffLines:I}=y,{additions:k,deletions:M}=wu(I),P={success:!0,file_path:f,diffLines:I,linesAdded:k,linesRemoved:M};';

const EDIT_REPLY_TAIL = 'yield{type:"result",isError:!1,value:JSON.stringify(P)}';

const STILL_MATCHES_ONCE =
  'async($ODpath)=>{if(c||a==="")return!1;let $ODnow=await hO($ODpath);' +
  'return!$ODnow.error&&($ODstale=Wse(dt($ODnow.content),{old_str:a,new_str:l,change_all:c}).success)}';

export const staleEditPatches: readonly Patch[] = [
  {
    name: 'edit-check-takes-stale-test',
    find: TOLERATE_PARAMETER,
    replace: 'async function VU(t,o,$ODtolerate){if(!t||typeof t!=="string")return{success:!1,',
  },
  {
    name: 'edit-refusal-asks-stale-test',
    find: REFUSAL_HEAD,
    replace:
      'if(await KR().hasFileChangedExternally(a.absolutePath)&&!($ODtolerate&&await $ODtolerate(a.absolutePath)))return{success:!1,',
  },
  {
    name: 'edit-accepts-stale-unique-match',
    find: EDIT_CHECKS,
    replace: EDIT_CHECKS.replace(
      'let p=await VU(o,u);',
      `let $ODstale=!1,p=await VU(o,u,${STILL_MATCHES_ONCE});`,
    ),
  },
  {
    name: 'edit-result-flags-stale-edit',
    find: EDIT_RESULT,
    replace: 'changesApplied:b.changesApplied,diffLines:k.diffLines,staleEdit:$ODstale}}catch(p)',
  },
  {
    name: 'edit-reply-notes-stale-edit',
    find: `${EDIT_REPLY_HEAD}if(v)P.systemReminder=v;${EDIT_REPLY_TAIL}`,
    replace:
      `${EDIT_REPLY_HEAD}if(v)P.systemReminder=v;` +
      'if(y.staleEdit)P.systemReminder=(P.systemReminder?P.systemReminder+"\\n\\n":"")+' +
      `${JSON.stringify(STALE_EDIT_NOTE)};${EDIT_REPLY_TAIL}`,
  },
];

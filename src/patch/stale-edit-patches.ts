import type { Patch } from './patches.ts';

export const STALE_EDIT_NOTE =
  'This file had changed since you last read it. The text you replaced still matched exactly once, so the edit went onto the current contents. Read the file before relying on any other part of it.';

const TOLERATE_PARAMETER = 'async function RY(t,o){if(!t||typeof t!=="string")return{success:!1,';

const REFUSAL_HEAD = 'if(await CA().hasFileChangedExternally(a.absolutePath))return{success:!1,';

const EDIT_CHECKS =
  'let g=await RY(o,f);if(!g.success)return{success:!1,message:g.message,filePath:o};' +
  'let y=await wn({filePath:o,oldStr:a,newStr:c,changeAll:l});';

const EDIT_RESULT = 'changesApplied:v,diffLines:I.diffLines}}catch(g)';

const EDIT_REPLY_HEAD =
  '{diffLines:I}=y,{additions:x,deletions:P}=ld(I),k={success:!0,file_path:f,diffLines:I,linesAdded:x,linesRemoved:P};';

const EDIT_REPLY_TAIL = 'yield{type:"result",isError:!1,value:JSON.stringify(k)}';

const STILL_MATCHES_ONCE =
  'async($ODpath)=>{if(l||a==="")return!1;' +
  'return $ODstale=(await wn({filePath:$ODpath,oldStr:a,newStr:c,changeAll:l})).success}';

export const staleEditPatches: readonly Patch[] = [
  {
    name: 'edit-check-takes-stale-test',
    find: TOLERATE_PARAMETER,
    replace: 'async function RY(t,o,$ODtolerate){if(!t||typeof t!=="string")return{success:!1,',
  },
  {
    name: 'edit-refusal-asks-stale-test',
    find: REFUSAL_HEAD,
    replace:
      'if(await CA().hasFileChangedExternally(a.absolutePath)&&!($ODtolerate&&await $ODtolerate(a.absolutePath)))return{success:!1,',
  },
  {
    name: 'edit-accepts-stale-unique-match',
    find: EDIT_CHECKS,
    replace: EDIT_CHECKS.replace(
      'let g=await RY(o,f);',
      `let $ODstale=!1,g=await RY(o,f,${STILL_MATCHES_ONCE});`,
    ),
  },
  {
    name: 'edit-result-flags-stale-edit',
    find: EDIT_RESULT,
    replace: 'changesApplied:v,diffLines:I.diffLines,staleEdit:$ODstale}}catch(g)',
  },
  {
    name: 'edit-reply-notes-stale-edit',
    find: `${EDIT_REPLY_HEAD}if(v)k.systemReminder=v;${EDIT_REPLY_TAIL}`,
    replace:
      `${EDIT_REPLY_HEAD}if(v)k.systemReminder=v;` +
      'if(y.staleEdit)k.systemReminder=(k.systemReminder?k.systemReminder+"\\n\\n":"")+' +
      `${JSON.stringify(STALE_EDIT_NOTE)};${EDIT_REPLY_TAIL}`,
  },
];

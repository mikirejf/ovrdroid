import { readFileSync, writeFileSync } from 'node:fs';

import { staleEditPatches } from '../stale-edit-patches.ts';
import type { FakeTracker } from './file-tracker-harness.ts';
import { occurrences, patchNamed, payloadFunction } from './payload.ts';

export interface EditReply {
  type: string;
  isError: boolean;
  llmError?: string;
  value?: string;
}

export interface EditCall {
  path: string;
  old: string;
  replacement: string;
  changeAll?: boolean;
  ideReminder?: string;
}

export interface Check {
  success: boolean;
  message: string;
}

interface ExecuteContext {
  toolCallId: string;
  ideReminder: string | undefined;
}

interface ExecuteInput {
  file_path: string;
  old_str: string;
  new_str: string;
  change_all: boolean | undefined;
}

interface Matched {
  success: boolean;
  changesApplied?: number;
  message: string;
}

export interface StockEdit {
  edit: (call: EditCall) => Promise<EditReply>;
  check: (path: string) => Promise<Check>;
}

function finds(name: string): string {
  return patchNamed(staleEditPatches, name).find;
}

const STOCK_SOURCE = [
  `${finds('edit-check-takes-stale-test')}message:"bad path"};`,
  'let a=await At(t);if(!a.wasRead)return{success:!1,message:"not read"};let c=CA();',
  `${finds('edit-refusal-asks-stale-test')}message:"Error: File "+t+" has been modified externally since it was last read."};`,
  'return{success:!0,message:a.absolutePath}}',
  'async function wn(t){let{filePath:o,oldStr:a,newStr:c,changeAll:l=!1}=t,f=await EH(o);',
  'if(f.error)return{success:!1,message:f.error};',
  'let p=f.content,g={old_str:a,new_str:c,change_all:l},y=ut(p),S=_r(y,g);',
  'if(!S.success)return{success:!1,message:S.message,oldContent:p};let T=vr(p,y,g);',
  'return{success:!0,file:f,oldContent:p,newContent:Ar(p,T),changesApplied:S.changesApplied}}',
  'async function jbe(t){let{filePath:o,oldStr:a,newStr:c,changeAll:l,toolCallId:f}=t;try{',
  finds('edit-accepts-stale-unique-match'),
  'if(!y.success)return{...y,filePath:o};let{file:S,oldContent:T,newContent:_,changesApplied:v}=y;',
  'let I=await fB({filePath:o,content:_,toolCallId:f,expectedOldContentBuffer:S.rawBuffer});',
  'if(!I.success)return{success:!1,message:I.message,oldContent:T,newContent:_,filePath:o};',
  'return{success:!0,message:"ok",oldContent:T,newContent:_,filePath:o,',
  finds('edit-result-flags-stale-edit'),
  '{return{success:!1,message:"Error editing file: "+g.message,filePath:o}}}',
  'async function*execute(t,o){let{file_path:f,old_str:l,new_str:c,change_all:d}=o;',
  'let y=await jbe({filePath:f,oldStr:l,newStr:c,changeAll:d,toolCallId:t.toolCallId});',
  'if(!y.success){yield{type:"result",isError:!0,llmError:y.message};return}',
  `let v=t.ideReminder,${finds('edit-reply-notes-stale-edit')}}`,
  'return{execute,RY}',
].join('');

function patched(): string {
  let source = STOCK_SOURCE;
  for (const patch of staleEditPatches) {
    if (occurrences(source, patch.find) !== 1) {
      throw new Error(`${patch.name} does not match the stock shape exactly once`);
    }
    source = source.replace(patch.find, () => patch.replace);
  }
  return source;
}

interface Built {
  execute: (context: ExecuteContext, input: ExecuteInput) => AsyncGenerator<EditReply>;
  RY: (path: string, id: string) => Promise<Check>;
}

interface Write {
  filePath: string;
  content: string;
  toolCallId: string;
  expectedOldContentBuffer: Buffer;
}

interface MatchEdit {
  old_str: string;
  new_str: string;
  change_all: boolean;
}

function stockMatch(content: string, edit: MatchEdit): Matched {
  if (edit.old_str === '' && content === '') {
    return { success: true, message: '', changesApplied: 1 };
  }
  if (edit.old_str === '') {
    return { success: false, message: 'Error: old_str is empty, but the file is not empty.' };
  }
  if (!content.includes(edit.old_str)) {
    return { success: false, message: 'Error: The text to replace was not found in the file.' };
  }
  const found = content.split(edit.old_str).length - 1;
  if (found > 1 && !edit.change_all) {
    return { success: false, message: `Error: Found ${found} occurrences of the text.` };
  }
  return { success: true, message: '', changesApplied: edit.change_all ? found : 1 };
}

function stockReplace(content: string, _normalized: string, edit: MatchEdit): string {
  return edit.change_all
    ? content.split(edit.old_str).join(edit.new_str)
    : content.replace(edit.old_str, () => edit.new_str);
}

export function stockEdit(tracker: FakeTracker, source = patched()): StockEdit {
  const build = payloadFunction<unknown[], Built>(
    ['At', 'CA', 'EH', '_r', 'ut', 'vr', 'Ar', 'fB', 'ld'],
    source,
  );
  const built = build(
    async (path: string) => await Promise.resolve({ absolutePath: path, wasRead: true }),
    () => tracker,
    async (path: string) => {
      const rawBuffer = readFileSync(path);
      return await Promise.resolve({ content: rawBuffer.toString('utf-8'), rawBuffer });
    },
    stockMatch,
    (content: string) => content,
    stockReplace,
    (_old: string, next: string) => next,
    async (write: Write) => {
      if (!readFileSync(write.filePath).equals(write.expectedOldContentBuffer)) {
        return { success: false, message: 'Error: File changed on disk since it was read.' };
      }
      writeFileSync(write.filePath, write.content);
      await tracker.trackFileOperation(write.filePath, write.toolCallId, 'edit');
      return { success: true, message: 'written', diffLines: [] };
    },
    () => ({ additions: 0, deletions: 0 }),
  );
  return {
    check: async (path) => await built.RY(path, 'call'),
    edit: async (call) => {
      const input = {
        file_path: call.path,
        old_str: call.old,
        new_str: call.replacement,
        change_all: call.changeAll,
      };
      const context = { toolCallId: 'call', ideReminder: call.ideReminder };
      for await (const reply of built.execute(context, input)) {
        return reply;
      }
      throw new Error('the edit yielded no reply');
    },
  };
}

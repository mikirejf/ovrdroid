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
  'let a=await Ct(t);if(!a.wasRead)return{success:!1,message:"not read"};',
  `${finds('edit-refusal-asks-stale-test')}message:"Error: File "+t+" has been modified externally since it was last read."};`,
  'return{success:!0,message:a.absolutePath}}',
  'async function cn(t){let{filePath:o,oldStr:a,newStr:l,changeAll:c=!1,toolCallId:u}=t;try{',
  finds('edit-accepts-stale-unique-match'),
  'if(!b.success)return{success:!1,message:b.message,filePath:o};',
  'let I=c?y.split(a).join(l):y.replace(a,()=>l);',
  'let k=await s9({filePath:o,content:I,toolCallId:u,expectedOldContentBuffer:g.rawBuffer});',
  'if(!k.success)return{success:!1,message:k.message,filePath:o};',
  'return{success:!0,message:"ok",',
  finds('edit-result-flags-stale-edit'),
  '{return{success:!1,message:"Error editing file: "+p.message,filePath:o}}}',
  'async function*execute(t,o){let{file_path:f,old_str:l,new_str:c,change_all:u}=o;',
  'let y=await cn({filePath:f,oldStr:l,newStr:c,changeAll:u,toolCallId:t.toolCallId});',
  'if(!y.success){yield{type:"result",isError:!0,llmError:y.message};return}',
  `let v=t.ideReminder,${finds('edit-reply-notes-stale-edit')}}`,
  'return{execute,VU}',
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
  VU: (path: string, id: string) => Promise<Check>;
}

interface Write {
  filePath: string;
  content: string;
  toolCallId: string;
  expectedOldContentBuffer: Buffer;
}

function stockMatch(content: string, edit: { old_str: string; change_all: boolean }): Matched {
  if (edit.old_str === '' && content === '') {
    return { success: true, message: '', changesApplied: 1 };
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

export function stockEdit(tracker: FakeTracker, source = patched()): StockEdit {
  const build = payloadFunction<unknown[], Built>(
    ['Ct', 'KR', 'hO', 'Wse', 'dt', 's9', 'wu'],
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
    check: async (path) => await built.VU(path, 'call'),
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

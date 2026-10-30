import { describe, expect, test } from 'bun:test';

import {
  creditNoteOf,
  noteOf,
  hooksWriting,
  HOOKS_OK,
  NO_HOOKS,
  outcomeOf,
  pathOf,
  trackedFile,
  useScratchFolder,
  writing,
  writtenWith,
} from './file-tracker-harness.ts';

useScratchFolder();

const SCRIPT_BLOCKS = [
  { type: 'text', text: 'Script Output from call-40' },
  { type: 'text', text: '[Script completed \u00B7 0.1 s elapsed \u00B7 2 calls]' },
];

const IMAGE_BLOCK = {
  type: 'image',
  source: { type: 'base64', data: 'AAAA', mediaType: 'image/png' },
};

describe('the notes on a tool result that is a list of content blocks', () => {
  test('a Script call that changed a tracked file keeps every block and ends with the credit note', async () => {
    const { path, tracker } = trackedFile('blocks-credit.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-40',
      name: 'Script',
      hooks: NO_HOOKS,
      result: SCRIPT_BLOCKS,
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toEqual([
      ...SCRIPT_BLOCKS,
      { type: 'text', text: creditNoteOf('Script', [path]) },
    ]);
    expect(JSON.stringify(result)).not.toContain('[object Object]');
  });

  test('a block list with an image keeps the image where it was', async () => {
    const { path, tracker } = trackedFile('blocks-image.ts');
    const blocks = [SCRIPT_BLOCKS[0], IMAGE_BLOCK, SCRIPT_BLOCKS[1]];

    const { result } = await outcomeOf({
      tracker,
      id: 'call-41',
      name: 'WaitForScript',
      hooks: NO_HOOKS,
      result: blocks,
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toEqual([
      ...blocks,
      { type: 'text', text: creditNoteOf('WaitForScript', [path]) },
    ]);
  });

  test('a hook change is appended to the block list as a text block too', async () => {
    const tracker = writtenWith('blocks-both.ts', 'a\n', 'call-42');
    const path = pathOf('blocks-both.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-42',
      hooks: hooksWriting({ [path]: 'b\n' }, HOOKS_OK),
      result: SCRIPT_BLOCKS,
    });

    expect(result).toEqual([...SCRIPT_BLOCKS, { type: 'text', text: noteOf(path, 'a\n', 'b\n') }]);
  });

  test('the model text stays a string beside a block list', async () => {
    const { path, tracker } = trackedFile('blocks-model.ts');

    const { result, modelContent } = await outcomeOf({
      tracker,
      id: 'call-43',
      hooks: NO_HOOKS,
      result: SCRIPT_BLOCKS,
      modelContent: 'Done.',
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toEqual([
      ...SCRIPT_BLOCKS,
      { type: 'text', text: creditNoteOf('Execute', [path]) },
    ]);
    expect(modelContent).toBe(`Done.\n\n${creditNoteOf('Execute', [path])}`);
  });

  test('a result that is neither text nor a block list is left as it was', async () => {
    const { path, tracker } = trackedFile('blocks-object.ts');
    const object = { applied: true };

    const { result } = await outcomeOf({
      tracker,
      id: 'call-45',
      hooks: NO_HOOKS,
      result: object,
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toBe(object);
  });

  test('no notes leave the block list as it was', async () => {
    const { tracker } = trackedFile('blocks-quiet.ts', 'edit');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-44',
      hooks: NO_HOOKS,
      result: SCRIPT_BLOCKS,
    });

    expect(result).toBe(SCRIPT_BLOCKS);
  });
});

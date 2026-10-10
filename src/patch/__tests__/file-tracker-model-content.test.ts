import { describe, expect, test } from 'bun:test';

import {
  creditNoteOf,
  hooksWriting,
  HOOKS_OK,
  noteOf,
  NO_HOOKS,
  outcomeOf,
  pathOf,
  trackedFile,
  useScratchFolder,
  WRITE_RESULT,
  writeResultWith,
  writing,
  writtenWith,
} from './file-tracker-harness.ts';

useScratchFolder();

const TRANSFORMED = 'File created.';

describe('the notes in the text the model reads when the tool has an output transform', () => {
  test('a hook change reaches the model text and the result', async () => {
    const tracker = writtenWith('model-hook.ts', 'a\n', 'call-30');
    const path = pathOf('model-hook.ts');
    const note = noteOf(path, 'a\n', 'b\n');

    const { result, modelContent } = await outcomeOf({
      tracker,
      id: 'call-30',
      hooks: hooksWriting({ [path]: 'b\n' }, HOOKS_OK),
      modelContent: TRANSFORMED,
    });

    expect(modelContent).toBe(`${TRANSFORMED}\n\n${note}`);
    expect(result).toBe(writeResultWith(note));
  });

  test('a call that changed tracked files reaches the model text and the result', async () => {
    const { path, tracker } = trackedFile('model-credit.ts');

    const { result, modelContent } = await outcomeOf({
      tracker,
      id: 'call-31',
      hooks: NO_HOOKS,
      name: 'Edit',
      modelContent: TRANSFORMED,
      tool: writing({ [path]: 'x\n' }),
    });

    const note = creditNoteOf('Edit', [path]);
    expect(modelContent).toBe(`${TRANSFORMED}\n\n${note}`);
    expect(result).toBe(writeResultWith(note));
  });

  test('a model text that is a JSON object carries the note in its system reminder', async () => {
    const { path, tracker } = trackedFile('model-json.ts');

    const { modelContent } = await outcomeOf({
      tracker,
      id: 'call-32',
      hooks: NO_HOOKS,
      modelContent: JSON.stringify({ applied: true }),
      tool: writing({ [path]: 'x\n' }),
    });

    expect(modelContent).toBe(
      JSON.stringify({ applied: true, systemReminder: creditNoteOf('Execute', [path]) }),
    );
  });

  test('no notes leave the model text byte for byte', async () => {
    const tracker = writtenWith('model-quiet.ts', 'a\n', 'call-33');

    const { result, modelContent } = await outcomeOf({
      tracker,
      id: 'call-33',
      hooks: NO_HOOKS,
      modelContent: TRANSFORMED,
    });

    expect(modelContent).toBe(TRANSFORMED);
    expect(result).toBe(WRITE_RESULT);
  });
});

describe('a tool without an output transform', () => {
  test('stays without model text and still gets the note in its result', async () => {
    const { path, tracker } = trackedFile('model-none.ts');

    const { result, modelContent } = await outcomeOf({
      tracker,
      id: 'call-34',
      hooks: NO_HOOKS,
      tool: writing({ [path]: 'x\n' }),
    });

    expect(modelContent).toBeUndefined();
    expect(result).toBe(writeResultWith(creditNoteOf('Execute', [path])));
  });
});

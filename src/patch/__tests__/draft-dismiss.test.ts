import { expect, mock, test } from 'bun:test';

import { patches } from '../patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Display {
  notice: { kind: 'hidden' | 'progress' };
  dismissed: boolean;
}

interface DraftNotice {
  display: Display;
  dismissAfterDraftEdit: () => void;
}

test('the stable draft callback dispatches only when there is a notice to dismiss', () => {
  const { replace } = patchNamed(patches, 'draft-dismiss-no-rerender');
  const hidden: Display = { notice: { kind: 'hidden' }, dismissed: false };
  const visible: Display = { notice: { kind: 'progress' }, dismissed: false };
  const ref = { current: hidden };
  const dispatch = mock<(action: { type: string }) => void>();
  let cachedCallback: (() => void) | undefined;
  const render = payloadFunction<
    [Display, () => typeof ref, (handler: () => void) => () => void, typeof dispatch],
    DraftNotice
  >(['C', 'S', 'g', 'y'], replace);
  const renderNotice = (display: Display) =>
    render(
      display,
      () => ref,
      (handler) => (cachedCallback ??= handler),
      dispatch,
    );

  const { dismissAfterDraftEdit } = renderNotice(hidden);
  dismissAfterDraftEdit();
  expect(dispatch).not.toHaveBeenCalled();

  expect(renderNotice(visible).dismissAfterDraftEdit).toBe(dismissAfterDraftEdit);
  dismissAfterDraftEdit();
  expect(dispatch).toHaveBeenCalledWith({ type: 'draft-edited' });

  renderNotice({ ...visible, dismissed: true });
  dismissAfterDraftEdit();
  expect(dispatch).toHaveBeenCalledTimes(1);
});

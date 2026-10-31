export const COPY_SELECT_PROMPT = 'Show me a quote.';
export const DRAFT_LINES = ['first draft line', 'second draft line'] as const;
export const QUOTE_FIRST = 'A quoted paragraph';
export const QUOTE_INTRO = 'A list item holding a quote:';
export const QUOTE_LAST = 'quote inside a list item';

export const COPY_SELECT_REPLY = [
  'Here is a quote:',
  '',
  `> ${QUOTE_FIRST} that is long enough to wrap around the right edge of the terminal when it is rendered, with a few more words to follow.`,
  '>',
  '> - first item inside the quote',
  '> - second item with a nested list',
  '>   - nested item',
  '>',
  '> > a nested quote line',
  '',
  `- ${QUOTE_INTRO}`,
  '',
  `  > ${QUOTE_LAST}`,
  '',
  'End of reply.',
].join('\n');

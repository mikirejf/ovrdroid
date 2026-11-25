import type { Item } from './session-mention-picker.ts';

const PATH_QUERY = /@(?:"(?<tag>[^"]+)|(?<query>\S*))$/u;

export const FILE_TIMINGS = {
  FILE_SUGGESTIONS_DEBOUNCE_MS: 50,
  FILE_SUGGESTIONS_LOADING_DELAY_MS: 100,
};

export function pathQuery({
  sent,
  cursorPosition,
}: {
  sent: { draft: string };
  cursorPosition: number;
}) {
  const match = PATH_QUERY.exec(sent.draft.slice(0, cursorPosition));
  if (match === null) {
    return null;
  }
  return {
    pathQuery: match.groups?.['tag'] ?? match.groups?.['query'] ?? '',
    startIndex: match.index,
    closedTag: match.groups?.['tag'] !== undefined && sent.draft[cursorPosition] === '"',
    draft: sent.draft,
  };
}

export function newService() {
  return {
    workingDirectory: '/work',
    getSuggestions: async (query: string) => {
      await Promise.resolve();
      return [{ label: query, value: query }];
    },
  };
}

export function completeFilePath({ selectedSuggestion }: { selectedSuggestion: Item }) {
  return {
    newText: `@${selectedSuggestion.value} `,
    newCursorPosition: selectedSuggestion.value.length + 2,
  };
}

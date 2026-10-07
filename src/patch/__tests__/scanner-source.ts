function sharedStrings(before: string, used: string): string {
  return [...before.matchAll(/\bvar (?<name>[\w$]+)="(?:[^"\\]|\\.)*"/gu)]
    .filter((declaration) => {
      const name = declaration.groups?.['name'] ?? '';
      return new RegExp(`(?<![\\w$])${name.replaceAll('$', String.raw`\$`)}(?![\\w$])`, 'u').test(
        used,
      );
    })
    .map((declaration) => `${declaration[0]};`)
    .join('');
}

export function scannerSource(text: string, rules: number, end: number): string {
  const start = text.lastIndexOf('function ', rules);
  const scanner = text.slice(start, rules + end);
  return `${sharedStrings(text.slice(0, start), scanner)}${scanner}`;
}

// oxlint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;:?]*[A-Za-z]/gu;
// oxlint-disable-next-line no-control-regex
const OSC = /\u001B\][^\u0007]*\u0007/gu;

export function plain(text: string): string {
  return text.replaceAll(ANSI, '').replaceAll(OSC, '');
}

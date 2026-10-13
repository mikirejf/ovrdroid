export const COPY_COMMAND =
  'curl -fsSL "https://downloads.example.com/releases/v2.14.3/tool-darwin-arm64.tar.gz?channel=stable&mirror=eu-west" -o /tmp/tool.tgz && tar --wildcards -xzf /tmp/tool.tgz "*/bin/tool" -C ~/.local/bin';

export const INLINE_REPLY_COMMAND = 'git push --no-verify -u origin devkit-run3';

export const INLINE_RESIZE_COMMAND = 'docker run --rm -it -v "$PWD":/work -w /work node:22 bash';

export const INLINE_LONG_COMMAND =
  'make -C /srv/payments release && kubectl -n payments rollout restart deployment/checkout-api && kubectl -n payments get pods';

const LONG_TAIL =
  ' to roll it out. The restart takes a few minutes, so keep the status open while the new pods start, warm their caches and pass their health checks, and only then tell the team that the release is live for everyone.';

const LEAD_WORDS = ['then', 'run', 'this', 'command', 'here', 'and', 'check', 'the', 'result'];

const OVERSHOOT = 10;

export function inlineParagraph(command: string, width: number): string {
  const room = width - command.length + OVERSHOOT;
  let lead = '';
  for (let at = 0; ; at += 1) {
    const next = `${lead}${LEAD_WORDS[at % LEAD_WORDS.length]} `;
    if (next.length > room) {
      break;
    }
    lead = next;
  }
  return `${lead}\`${command}\` when done.`;
}

export function longInlineParagraph(command: string): string {
  return `Last, run \`${command}\`${LONG_TAIL}`;
}

export function copyReply(cols: number, resizeTo: number): string {
  return [
    'Run this to install it:',
    '',
    '```sh',
    COPY_COMMAND,
    'tool --version',
    '```',
    '',
    'That puts the binary on your PATH.',
    '',
    inlineParagraph(INLINE_REPLY_COMMAND, cols),
    '',
    inlineParagraph(INLINE_RESIZE_COMMAND, resizeTo),
    '',
    longInlineParagraph(INLINE_LONG_COMMAND),
  ].join('\n');
}

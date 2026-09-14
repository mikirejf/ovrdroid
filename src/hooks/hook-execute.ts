#!/usr/bin/env bun
import { readToolCall } from './hook-payloads.ts';
import { guardHook } from './hook-runtime.ts';
import { parseRm } from './rm-command.ts';
import { inspect, readEnvironment } from './rm-facts.ts';
import { decide } from './rm-policy.ts';

const HOOK_EVENT = 'PreToolUse';
const ALLOW = 'allow';

function verdict(reason: string, command: string): string {
  const hookSpecificOutput = {
    hookEventName: HOOK_EVENT,
    permissionDecision: ALLOW,
    permissionDecisionReason: reason,
    updatedInput: { command },
  };
  return `${JSON.stringify({ hookSpecificOutput })}\n`;
}

async function run(): Promise<void> {
  const call = readToolCall(await Bun.stdin.text());
  if (call === undefined) {
    return;
  }

  const parsed = parseRm(call.command);
  if (parsed === undefined) {
    return;
  }

  const environment = readEnvironment(call.cwd);
  const decision = decide(
    parsed,
    parsed.paths.map((token) => inspect(token, environment)),
  );
  if (decision.kind === 'pass') {
    return;
  }

  process.stdout.write(verdict(decision.reason, decision.command));
}

await guardHook(run);

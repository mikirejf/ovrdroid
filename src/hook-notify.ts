#!/usr/bin/env bun
import { isNotificationPayload } from './hook-payloads.ts';
import { guardHook } from './hook-runtime.ts';
import { playAwaitingSound } from './notify-sound.ts';

const PERMISSION_PROMPT = 'permission_prompt';

async function run(): Promise<void> {
  const payload: unknown = JSON.parse(await Bun.stdin.text());
  if (!isNotificationPayload(payload) || payload.notification_type !== PERMISSION_PROMPT) {
    return;
  }

  await playAwaitingSound();
}

await guardHook(run);

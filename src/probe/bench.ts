#!/usr/bin/env bun
import { say, seconds } from '../cli.ts';
import { INSTALLED_DROID } from '../paths.ts';
import { launch } from './launch.ts';

const RUNS = 3;

async function repeat(target: string, remaining: number): Promise<void> {
  if (remaining === 0) {
    return;
  }
  const timing = await launch(target);
  say(`paint ${seconds(timing.paintMs)}  exit ${seconds(timing.exitMs)}`);
  await repeat(target, remaining - 1);
}

const target = process.argv[2] ?? INSTALLED_DROID;
say(target);
await repeat(target, RUNS);

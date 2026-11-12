import { describe, expect, test } from 'bun:test';

import { probeAnswerer } from '../launch.ts';

const ESC = String.fromCodePoint(0x1b);
const QUERY = `${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\`;
const REPLY = `${ESC}_Gi=31;OK${ESC}\\`;
const DEVICE_QUERY = `${ESC}[c`;
const DEVICE_REPLY = `${ESC}[?62;22c`;

describe('probeAnswerer graphics injection', () => {
  test('the default answers remain unchanged and do not claim graphics support', () => {
    const replies: string[] = [];
    const terminal = { write: (reply: string | Uint8Array) => replies.push(String(reply)) };
    probeAnswerer()(terminal, QUERY + DEVICE_QUERY);
    expect(replies).toEqual([DEVICE_REPLY]);
  });

  test('optional graphics answers precede the device-attributes response that ends detection', () => {
    const replies: string[] = [];
    const terminal = { write: (reply: string | Uint8Array) => replies.push(String(reply)) };
    const answer = probeAnswerer([[QUERY, REPLY]]);
    answer(terminal, QUERY + DEVICE_QUERY);
    answer(terminal, QUERY + DEVICE_QUERY);
    expect(replies).toEqual([REPLY, DEVICE_REPLY]);
  });

  test('a graphics query split across PTY chunks is answered once', () => {
    const replies: string[] = [];
    const terminal = { write: (reply: string | Uint8Array) => replies.push(String(reply)) };
    const answer = probeAnswerer([[QUERY, REPLY]]);
    answer(terminal, QUERY.slice(0, 12));
    expect(replies).toEqual([]);
    answer(terminal, QUERY.slice(12));
    expect(replies).toEqual([REPLY]);
  });
});

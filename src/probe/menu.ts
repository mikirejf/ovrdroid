import type { Frame, Session, SessionOptions } from './session.ts';
import { openSession } from './session.ts';

export const LOADING_TEXT = 'Loading custom commands';
export const FOOTER_TEXT = 'for help';
const OPEN_KEYS = '/dele';
const BACKSPACE = '\u007F';
const QUIET_MS = 500;
const SETTLE_TIMEOUT_MS = 3000;
const MENU_TIMEOUT_MS = 2500;

export interface MenuReading {
  loadingFrames: number;
  totalFrames: number;
  footerFirstFrame: boolean;
  footerLastFrame: boolean;
  listsCommands: boolean;
}

function has(frames: readonly Frame[], needle: string): boolean {
  return frames.some((frame) => frame.text.includes(needle));
}

export function readFrames(frames: readonly Frame[]): MenuReading {
  const first = frames.at(0);
  const last = frames.at(-1);
  return {
    loadingFrames: frames.filter((frame) => frame.text.includes(LOADING_TEXT)).length,
    totalFrames: frames.length,
    footerFirstFrame: first?.text.includes(FOOTER_TEXT) ?? false,
    footerLastFrame: last?.text.includes(FOOTER_TEXT) ?? false,
    listsCommands: has(frames, 'delegate'),
  };
}

export interface MenuSession extends Session {
  open: () => Promise<MenuReading>;
  closeMenu: () => Promise<MenuReading>;
}

export async function openMenuSession(
  binary: string,
  options: SessionOptions = {},
): Promise<MenuSession> {
  const session = await openSession(binary, options);
  await session.quiet(QUIET_MS, SETTLE_TIMEOUT_MS);

  const typeThenRead = async (keys: string): Promise<MenuReading> => {
    session.mark();
    await session.type(keys);
    await session.quiet(QUIET_MS, MENU_TIMEOUT_MS);
    return readFrames(session.frames());
  };

  return {
    ...session,
    open: async () => await typeThenRead(OPEN_KEYS),
    closeMenu: async () => await typeThenRead(BACKSPACE.repeat(OPEN_KEYS.length)),
  };
}

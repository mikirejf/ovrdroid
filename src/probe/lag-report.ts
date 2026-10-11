import { say } from '../cli.ts';
import { formatLag, parseLag } from './lag.ts';

export async function lag(file: string): Promise<void> {
  say(formatLag(parseLag(await Bun.file(file).text())));
}

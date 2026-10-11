import type { Sample } from './idle.ts';
import { parsePs } from './idle.ts';
import { stdoutOf } from './run.ts';
import { treeOf } from './tree.ts';

export async function sampleTree(root: number): Promise<Sample[]> {
  const tree = await treeOf(root);
  const listing = await stdoutOf([
    'ps',
    '-o',
    'pid=,utime=,stime=,rss=',
    ...[...tree.keys()].flatMap((pid) => ['-p', String(pid)]),
  ]);
  return parsePs(listing, performance.now());
}

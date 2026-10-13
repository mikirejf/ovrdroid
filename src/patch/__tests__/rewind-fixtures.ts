export interface Invocation {
  taskInvocationId: string;
  parentSessionId: string;
  parentToolUseId: string;
  childSessionId: string;
  runInBackground: boolean;
  status: string;
  parentTranscriptPath?: string;
  updatedAt?: number;
}

export interface Tag {
  name: string;
  metadata?: Record<string, string>;
}

export type MoveArgs = [from: string, to: string, kept: Set<string>, transcriptPath: string];

export type Mover = (...args: MoveArgs) => Promise<Invocation[]>;

export interface Globals {
  __odRewindMoveTasks?: Mover;
}

export const OLD = 'old-chat';
export const NEW = 'new-chat';

export function running(id: string, change: Partial<Invocation> = {}): Invocation {
  return {
    taskInvocationId: id,
    parentSessionId: OLD,
    parentToolUseId: `call-${id}`,
    childSessionId: `child-${id}`,
    runInBackground: true,
    status: 'running',
    ...change,
  };
}

export function isActive(status: string): boolean {
  return status === 'pending' || status === 'running';
}

export interface ToolCall {
  command: string;
  cwd: string;
}

interface ExecutePayload {
  tool_input: { command: string };
  cwd: string;
}

interface NotificationPayload {
  notification_type: string;
  session_id: string;
  transcript_path: string;
}

interface SessionTag {
  name: string;
}

interface TaggedSettings {
  tags: readonly SessionTag[];
}

interface SoundSettings {
  awaitingInputSound: string;
}

export function isExecutePayload(value: unknown): value is ExecutePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('cwd' in value) || typeof value.cwd !== 'string') {
    return false;
  }
  if (!('tool_input' in value)) {
    return false;
  }

  const input: unknown = value.tool_input;
  return (
    typeof input === 'object' &&
    input !== null &&
    'command' in input &&
    typeof input.command === 'string'
  );
}

export function isNotificationPayload(value: unknown): value is NotificationPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'notification_type' in value &&
    typeof value.notification_type === 'string' &&
    'session_id' in value &&
    typeof value.session_id === 'string' &&
    'transcript_path' in value &&
    typeof value.transcript_path === 'string'
  );
}

export function isSoundSettings(value: unknown): value is SoundSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    'awaitingInputSound' in value &&
    typeof value.awaitingInputSound === 'string'
  );
}

function isNamedTag(value: unknown): value is SessionTag {
  return (
    typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'
  );
}

export function isTaggedSettings(value: unknown): value is TaggedSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tags' in value &&
    Array.isArray(value.tags) &&
    value.tags.every(isNamedTag)
  );
}

export function readToolCall(raw: string): ToolCall | undefined {
  const payload: unknown = JSON.parse(raw);
  if (!isExecutePayload(payload) || payload.cwd === '') {
    return undefined;
  }
  return { command: payload.tool_input.command, cwd: payload.cwd };
}

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
    typeof value.notification_type === 'string'
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

export function readToolCall(raw: string): ToolCall | undefined {
  const payload: unknown = JSON.parse(raw);
  if (!isExecutePayload(payload) || payload.cwd === '') {
    return undefined;
  }
  return { command: payload.tool_input.command, cwd: payload.cwd };
}

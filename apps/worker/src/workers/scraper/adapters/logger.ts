import type { LoggerPort } from '../ports';

type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, event: string, payload?: Record<string, unknown>) {
  const entry = { level, event, ...((payload ?? {}) as Record<string, unknown>) };
  const serialized = JSON.stringify(entry);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export class ConsoleLogger implements LoggerPort {
  info(event: string, payload?: Record<string, unknown>): void {
    emit('info', event, payload);
  }

  warn(event: string, payload?: Record<string, unknown>): void {
    emit('warn', event, payload);
  }

  error(event: string, payload?: Record<string, unknown>): void {
    emit('error', event, payload);
  }
}

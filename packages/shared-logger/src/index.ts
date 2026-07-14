import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface CreateLoggerOptions {
  readonly filePath?: string;
}

export function createLogger(source: string, opts: CreateLoggerOptions = {}): Logger {
  const { filePath } = opts;

  function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      ...(meta !== undefined ? { meta } : {}),
    };

    process.stderr.write(`[${source}] ${level.toUpperCase()}: ${message}\n`);

    if (filePath !== undefined) {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
      } catch {
        // Best-effort file write — disk/permission errors must never propagate
        // out of the logger (mirroring the "never throws" contract of shared-notify).
        process.stderr.write(`[${source}] WARN: failed to write log entry to ${filePath}\n`);
      }
    }
  }

  return {
    debug(message, meta) { log("debug", message, meta); },
    info(message, meta) { log("info", message, meta); },
    warn(message, meta) { log("warn", message, meta); },
    error(message, meta) { log("error", message, meta); },
  };
}

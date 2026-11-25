import crypto from 'node:crypto';
import { styleText } from 'node:util';
import type { Request, Response, NextFunction } from 'express';

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: 'gray', info: 'cyan', warn: 'yellow', error: 'red' } as const;

const envLevel = process.env.LOG_LEVEL as Level | undefined;
const MIN_LEVEL = LEVELS[envLevel && envLevel in LEVELS ? envLevel : 'info'];
const JSON_FORMAT = process.env.LOG_FORMAT === 'json';

function write(level: Level, msg: string, fields: Fields = {}): void {
  if (LEVELS[level] < MIN_LEVEL) return;
  const time = new Date().toISOString();
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;

  if (JSON_FORMAT) {
    out.write(JSON.stringify({ time, level, msg, ...fields }) + '\n');
    return;
  }
  const extras = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' && !/\s/.test(v) ? v : JSON.stringify(v)}`)
    .join(' ');
  const tag = styleText(COLORS[level], level.toUpperCase().padEnd(5));
  out.write(`${styleText('dim', time)} ${tag} ${msg}${extras ? ' ' + styleText('dim', extras) : ''}\n`);
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

function createLogger(base: Fields = {}): Logger {
  const at = (level: Level) => (msg: string, fields?: Fields) => write(level, msg, { ...base, ...fields });
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

export const log = createLogger();

/**
 * Gives each request an id and a child logger (res.locals.log), and logs one line when the
 * response finishes, or a warning if the client disconnects before it does.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const reqId = crypto.randomBytes(4).toString('hex');
  const elapsed = () => Number((process.hrtime.bigint() - start) / 1_000_000n);
  res.locals.log = log.child({ req: reqId });
  res.locals.elapsed = elapsed;
  res.set('X-Request-Id', reqId);

  res.on('finish', () => {
    const level: Level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    const isStatic = res.statusCode < 400 && /\.(css|js|ico|png|svg)$/.test(req.path);
    write(isStatic ? 'debug' : level, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      req: reqId,
      ms: elapsed(),
      bytes: res.getHeader('Content-Length'),
    });
  });
  res.on('close', () => {
    if (!res.writableFinished) {
      res.locals.log.warn(`${req.method} ${req.originalUrl} aborted by client`, { ms: elapsed() });
    }
  });
  next();
}

/** Last-resort error handler: logs the error and sends a plain 500 if nothing was sent yet. */
export function errorLogger(err: unknown, req: Request, res: Response, next: NextFunction): void {
  (res.locals.log ?? log).error(`${req.method} ${req.originalUrl} failed`, {
    error: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
  if (res.headersSent) return next(err);
  res.status(500).type('text/plain').send('Internal Server Error');
}

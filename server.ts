import path from 'node:path';
import express, { type Response } from 'express';
import cookieParser from 'cookie-parser';
import { securityHeaders, session, csrfProtection } from './src/security.ts';
import { render, patch } from './src/render.ts';
import { log, requestLogger, errorLogger } from './src/log.ts';
import { listTodos, addTodo, removeTodo, countTodos, type Todo } from './src/store.ts';

const PORT = Number(process.env.PORT ?? 3000);
const LIST_LATENCY_MS = Number(process.env.LIST_LATENCY_MS ?? 2000);
const MAX_TITLE = 200;

const app = express();
app.disable('x-powered-by');
app.use(requestLogger);
app.use(securityHeaders);
app.use(express.static(path.join(import.meta.dirname, 'public'), { index: false }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: false, limit: '4kb' }));
app.use(session);
app.use(csrfProtection);

function startStream(res: Response, status = 200): void {
  res.status(status).set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no', // disable proxy buffering so chunks arrive as written
  });
}

const countHtml = (count: number) => render('partials/counter', { count });
const itemHtml = (res: Response, todo: Todo) =>
  render('partials/todo-item', { ...todo, csrf: res.locals.csrfToken() });

interface PageOptions {
  status?: number;
  error?: string;
  value?: string;
}

/**
 * Full page. The shell (with <?start name="todo-list">Loading…<?end>) is flushed first, then the list
 * is streamed later in the SAME response as out-of-order <template for> patches, applied by the browser.
 */
async function renderPage(res: Response, { status = 200, error, value }: PageOptions = {}): Promise<void> {
  startStream(res, status);
  res.write(
    render('layout-head', {
      nonce: res.locals.nonce,
      form: render('partials/add-form', { csrf: res.locals.csrfToken(), error, value }),
      count: countHtml(countTodos()),
    }),
  );

  res.locals.log.info('shell flushed', { ms: res.locals.elapsed() });

  const todos = await listTodos({ latency: LIST_LATENCY_MS });
  if (res.destroyed) return; // client went away; requestLogger reports the abort

  const items = todos.map((t) => itemHtml(res, t)).join('');
  res.write(patch('todo-list', items));
  res.write(patch('count', countHtml(todos.length)));
  res.end(render('layout-foot'));
  res.locals.log.info('patches streamed', { patches: ['todo-list', 'count'], items: todos.length, ms: res.locals.elapsed() });
}

app.get('/', (_req, res) => renderPage(res));

/** Add a TODO, then Post/Redirect/Get. Invalid input re-renders the page with an error. */
app.post('/todos', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title || title.length > MAX_TITLE) {
    const error = title ? `Max ${MAX_TITLE} characters.` : 'Please type something first.';
    res.locals.log.info('todo rejected', { reason: error, length: title.length });
    return renderPage(res, { status: 422, error, value: title.slice(0, MAX_TITLE) });
  }
  const todo = addTodo(title);
  res.locals.log.info('todo added', { id: todo.id, total: countTodos() });
  res.redirect(303, '/');
});

/** Delete a TODO, then Post/Redirect/Get. */
app.post('/todos/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const removed = Number.isInteger(id) && removeTodo(id);
  res.locals.log.info(removed ? 'todo deleted' : 'todo not found', { id: req.params.id, total: countTodos() });
  res.redirect(303, '/');
});

app.use(errorLogger);

app.listen(PORT, () => log.info(`TODO PoC listening on http://localhost:${PORT}`, { listLatencyMs: LIST_LATENCY_MS }));

process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { error: String(reason) }));

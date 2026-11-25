import fs from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';

const VIEWS = path.resolve(import.meta.dirname, '../views');
const hbs = Handlebars.create();

type PIKind = 'start' | 'end' | 'marker';
const PI_KINDS: ReadonlySet<string> = new Set<PIKind>(['start', 'end', 'marker']);

/**
 * Emits a processing instruction used by Declarative Partial Updates:
 *   {{pi "start" "name"}}  -> <?start name="name">
 *   {{pi "marker" "name"}} -> <?marker name="name">
 *   {{pi "end"}}           -> <?end>
 * No trailing "?": HTML PIs end at the first ">".
 */
hbs.registerHelper('pi', (kind: unknown, name: unknown) => {
  if (typeof kind !== 'string' || !PI_KINDS.has(kind)) throw new Error(`bad PI ${String(kind)}`);
  const attr = typeof name === 'string' ? ` name="${hbs.escapeExpression(name)}"` : '';
  return new hbs.SafeString(`<?${kind}${attr}>`);
});

hbs.registerHelper('plural', (n: unknown, one: string, many: string) => (n === 1 ? one : many));

// Trim partials: a trailing newline would land outside the <?end> and pile up with every patch.
const source = (rel: string): string => {
  const text = fs.readFileSync(path.join(VIEWS, rel), 'utf8');
  return rel.startsWith('partials') ? text.trim() : text;
};

for (const file of fs.readdirSync(path.join(VIEWS, 'partials'))) {
  hbs.registerPartial(path.basename(file, '.hbs'), source(path.join('partials', file)));
}

const cache = new Map<string, HandlebarsTemplateDelegate>();

/** Renders views/<name>.hbs (or a partial via "partials/<name>"). */
export function render(name: string, data: object = {}): string {
  let template = cache.get(name);
  if (!template || process.env.NODE_ENV !== 'production') {
    template = hbs.compile(source(`${name}.hbs`));
    cache.set(name, template);
  }
  return template(data);
}

/** Wraps HTML in a patch: <template for="target">…</template> */
export function patch(target: string, html: string): string {
  return `<template for="${hbs.escapeExpression(target)}">${html}</template>\n`;
}

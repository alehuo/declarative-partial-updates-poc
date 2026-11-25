# Declarative Partial Updates — TODO PoC

A server-rendered TODO app (list / add / delete) where the server streams **HTML patches** to the page
using the [WICG Declarative Partial Updates](https://github.com/WICG/declarative-partial-updates) proposal:

```html
<ul>
  <?start name="todo-list"><li>Loading…</li><?end>   <!-- target range -->
</ul>
…
<template for="todo-list"> …real items… </template>  <!-- patch, streamed later -->
```

Stack: Node.js + Express 5 in native TypeScript (Node runs the `.ts` files directly, no build step), Handlebars templates, Tailwind CSS v4 (CLI build), no frontend framework.

## Run

```bash
npm install
npm start          # builds Tailwind → public/app.css, serves http://localhost:3000
```

`npm run typecheck` runs `tsc` (type-check only, no output). Requires Node ≥ 22.18 for native type stripping.

`npm run dev` does the same as `npm start`, but rebuilds the CSS and restarts the server when files change.
Env vars: `PORT` (3000), `LIST_LATENCY_MS` (2000, simulated slow list read), `CSRF_SECRET` (random per boot if unset).
`LOG_LEVEL` (`debug` | `info` | `warn` | `error`, default `info`; `debug` adds static files and new sessions),
`LOG_FORMAT=json` for one JSON object per line instead of the coloured text format.

## How it works

| Interaction | Request | Response |
|---|---|---|
| Page load | `GET /` | Shell flushed immediately; ~2 s later, in the **same response**: `<template for="todo-list">` + `<template for="count">` |
| Add | `POST /todos` | `303 → /` (invalid title: `422` + the page re-rendered with an error) |
| Delete | `POST /todos/:id/delete` | `303 → /` |

- **No JavaScript.** The browser is assumed to implement Declarative Partial Updates natively: it applies the
  `<template for>` patches to the `<?start name>…<?end>` ranges while the document streams in.
- Forms are plain `<form method="post">` using Post/Redirect/Get. Each redirect loads a new, streamed page.

## Security

- **CSP with per-request nonce**: `script-src 'nonce-…' 'strict-dynamic'; style-src 'self'; object-src 'none';
  base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. The page currently ships no scripts; any script added later must carry the nonce.
- **CSRF**: an anonymous `sid` cookie (HttpOnly, SameSite=Lax) plus a stateless token, `salt.HMAC(secret, sid.salt)`.
  The token goes in each form's hidden `_csrf` field (an `X-CSRF-Token` header is also accepted).
  Every non-GET request is checked with `timingSafeEqual`. It also gets a 403 if `Sec-Fetch-Site` is cross-site
  or `Origin` doesn't match.
- User text is HTML-escaped by Handlebars `{{ }}`; titles are capped at 200 chars; bodies at 4 kB.

## Try it with curl

```bash
curl -N localhost:3000/                          # watch the list patch arrive after the shell
curl -i -X POST -d title=x localhost:3000/todos  # 403: no CSRF token
```

## Files

```
server.ts            routes + streaming
src/security.ts      nonce/CSP headers, session cookie, CSRF
src/render.ts        Handlebars setup, {{pi}} helper for <?start>/<?end>/<?marker>, patch()
src/log.ts           logger, per-request logging (X-Request-Id), error handler
src/store.ts         in-memory store (reset on restart)
views/               layout + partials
src/types.d.ts       Express Request/Locals augmentations
src/input.css        Tailwind entry
tsconfig.json        strict, erasableSyntaxOnly, noEmit
```

Limitations (PoC): in-memory data, no auth. The page only works in a browser that implements the proposal;
elsewhere the list stays on "Loading…". This is untested because no shipping browser implements it yet.

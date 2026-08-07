# Changelog

All notable changes to `chatarmor` are documented here. This project adheres to
[Semantic Versioning](https://semver.org/). Being pre-1.0, a **minor** bump may
carry breaking changes — those are called out explicitly below.

## [0.2.1] — 2026-08-06

Docs-only patch. No code, `dist/`, or behavior changes from 0.2.0.

### Changed

- **README no longer names real client projects.** The credibility line
  ("shipped three times in production") now describes the track record
  without naming the specific products it shipped in.

## [0.2.0] — 2026-07-27

Security release. Two independent audits found that the package's
headline promises were not actually enforced in code. This release makes them
true and ships regression tests that fail if they ever regress again.

### Upgrading from 0.1.0 — nothing breaks

**`npm install chatarmor@0.2.0` requires no code changes.** Every 0.1.0 call
shape still compiles and behaves as it did. The new shapes below are the
recommended ones and the old ones are removed in **1.0.0** — migrate at your
leisure, not under pressure.

- **`reply()` now takes `(message, options)`**, with the untrusted user message
  as its own first argument, so a request body cannot smuggle a `systemPrompt`
  or pick its own `budgetSubKey`. The 0.1.x `reply(input)` overload is still
  accepted, with identical behaviour, and logs a deprecation notice once per
  service instance.

  ```ts
  // 0.1.x — still works in 0.2.0, deprecated
  await chat.reply({ message: body.message, systemPrompt: '…', budgetSubKey: user.id });

  // 0.2.0 — recommended
  await chat.reply(body.message, { systemPrompt: '…', budgetSubKey: user.id });
  ```

- **`ChatArmorReplyOptions` is the new options type.** `ChatArmorReplyInput` is
  still exported (deprecated) so existing imports keep compiling.

- **Angular widget: the request field is now `clientTraceId`.** The widget posts
  **both** `clientTraceId` and the former `sessionId` with the same value, so an
  endpoint that still reads `body.sessionId` keeps working. `ChatRequest.sessionId`
  remains available as a deprecated alias. Never wire either into `budgetSubKey`:
  a client-generated id can be rotated per request and can never gate spending.

- **`ChatArmorReason` gained a member, `'invalid-input'`**, returned when the
  message is not a string. Additive — it only affects you if you exhaustively
  `switch` over `reason` with no `default`.

### Fixed

- **`reply()` never throws — for real (M-01).** A non-string `message` (number,
  object, array, boolean, `null`) used to throw a `TypeError` before the
  try/catch, turning a `POST {"message":123}` into a 500. Input is now normalized
  defensively at the boundary (non-string → `reason: 'invalid-input'`) and the
  whole body is wrapped, so the "never throws" invariant holds against malformed
  input. Verified against the compiled `dist/`.

- **Spend cap can no longer be bypassed by a client-chosen `budgetSubKey`
  (M-02).** `budgetSubKey` is now a server-authoritative field in `options`,
  unreachable from the request body by construction, and is sanitized to
  `[A-Za-z0-9._-]` (≤128 chars) to block `:` namespace-injection. A malformed
  subKey is ignored (metered against the global bucket) and logged without its
  raw value.

- **Trust boundary split so `systemPrompt` can't be hijacked (M-03).** The
  untrusted message and server config are now distinct arguments; a client can no
  longer control the system prompt via a spread body.

- **PII no longer logged (L-03).** The spend-cap warning no longer prints the raw
  `budgetSubKey` (which may be an IP or user id); it logs only counts and whether
  the bucket was scoped or global.

- **Upstream error bodies are truncated in logs (L-04).** Gemini/OpenAI non-2xx
  response bodies embedded in thrown errors are capped at 200 chars.

- **Doc/code contradiction on `reason` fixed (L-02).** Clarified that `reason` /
  `degraded` are for server-side logs/metrics and must not be forwarded to the
  client.

### Changed

- **CI now runs on `dev` and audits production dependencies**
  (`npm audit --omit=dev --audit-level=high`) (L-05).
- Removed unused `Logger` fields from the Gemini/OpenAI providers (L-07).

### Not changed (deferred — product decision)

- **Spend cap `failOpen` default stays `true`** (L-01). Flipping it to fail-closed
  is a genuine availability trade-off (a Redis outage would take the assistant
  down) and is left to the integrator via `budget.failOpen: false`, now
  recommended for security-first deployments in the README. Revisit for v1.

## [0.1.0]

- Initial release: armored NestJS AI chat endpoint (Gemini/OpenAI), anti-prompt
  injection via separate turns, `llm-budget-cap` spend cap, and a copy-paste
  Angular widget.

# Changelog

All notable changes to `chatarmor` are documented here. This project adheres to
[Semantic Versioning](https://semver.org/). Being pre-1.0, a **minor** bump may
carry breaking changes — those are called out explicitly below.

## [0.2.2] — 2026-08-07

Dependency-security patch. ChatArmor shipped against `llm-budget-cap@^0.1.0`,
and npm's caret range never crosses a `0.x` minor — so every install since 0.1.0
resolved to `llm-budget-cap@0.1.x` and none of the hardening in its 0.2.0
security release ever reached ChatArmor users. The range is now `^0.2.0`.

**No API changes.** `reply()`, `budgetSubKey`, `ChatArmorResult` and the module
options are identical; `npm install chatarmor@0.2.2` requires no code changes.
That is why this is a patch and not a minor.

### Fixed

- **A hung Redis no longer hangs the chat request.** `llm-budget-cap@0.1.0`
  had no timeout around its Redis call. With the client config the README used to
  show (plain `new Redis(url)`, i.e. ioredis' `enableOfflineQueue: true`), a dead
  Redis queues the command **offline and never rejects** — so the spend-cap check
  never settled, `failOpen` never fired, and `reply()` hung indefinitely instead
  of honouring its "always resolves, never throws" contract. `llm-budget-cap@0.2.0`
  applies a hard per-call `timeoutMs` (default 5000 ms), so the call is now decided
  by `failOpen` within a bounded time. The README quickstart also now sets
  `enableOfflineQueue: false` and `maxRetriesPerRequest: 2`, so failures are fast
  and clean rather than merely bounded.
- **`ChatArmorResult.degraded` is now actually reachable.** It was documented as
  "true when the spend cap ran in degraded (Redis-down, fail-open) mode", but was
  only ever set on the `budget-exceeded` branch — a branch a degraded decision can
  never reach, since degrading implies `allowed: true`. The flag was therefore
  dead: an operator running the default `failOpen: true` had **no way to learn
  their spend cap had stopped counting**. `degraded: true` is now carried on every
  result produced after an unmetered check (including `ok: true` replies), and the
  service logs a warning when it happens.
- **A malformed `budgetSubKey` can no longer leak into a Redis key.**
  `llm-budget-cap@0.2.0` validates `subKey` (`[A-Za-z0-9_.-]`, 1–128 chars, no
  `:`) instead of concatenating whatever it is given, and rejects the empty string
  rather than letting it fall through to the global counter. ChatArmor already
  normalized `budgetSubKey` before passing it down, so this is defence in depth —
  and new tests pin the two validators together, so a future drift between them
  fails the suite instead of silently turning scoped calls into `reason: 'error'`.
- **A Redis failure can no longer leak the counter key into your logs.** With
  `failOpen: false`, 0.1.0 re-threw the raw ioredis error, whose `command.args`
  embed the full key — including the per-user/per-IP `budgetSubKey`. 0.2.0 wraps
  it in a `BudgetCapError` and keeps the original as `cause`.
- **A counter that overflows or holds a non-numeric value is now treated as an
  error** (routed through `failOpen`) instead of being reported as a bogus
  `allowed: true` with `degraded: false`.

### Notes

- **Still `checkAndIncrement`, deliberately.** `llm-budget-cap@0.2.0` adds
  `reserve()`/`settle()` for costs that are only knowable **after** the paid call
  (token counts). ChatArmor meters **one unit per LLM call** — an amount known up
  front — and already charged the counter **before** `provider.generate()`, which
  is the ordering that makes the cap a real ceiling. That is the documented
  correct use of `checkAndIncrement`, so the concurrency overspend `reserve`/
  `settle` fixes never applied here. New tests assert the bound directly: 50
  concurrent `reply()` calls against `limit: 5` reach the LLM exactly 5 times.
- `llm-budget-cap@0.2.0`'s new `timeoutMs` and `onDegraded` options are not yet
  exposed through `ChatArmorBudgetOptions`; the 5000 ms timeout default applies
  regardless. Surfacing them is additive API and belongs in a minor.

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

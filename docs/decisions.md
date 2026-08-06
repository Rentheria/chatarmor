# Decisions

Non-obvious calls made in this package, so they are not re-litigated or
accidentally reverted. Newest first.

## 2026-07-27 — 0.2.0 ships the security fix WITHOUT breaking 0.1.0

**Context.** Two independent audits found the headline promises were not enforced
(`reply()` did throw; a request body spread into `reply(input)` could smuggle a
`systemPrompt` or pick its own `budgetSubKey`). The first fix redesigned the
public API: `reply(input)` → `reply(message, options)`, `ChatArmorReplyInput`
deleted, and the widget's `sessionId` renamed to `clientTraceId`. That closed the
holes but made 0.2.0 a breaking upgrade.

**Decision.** Keep both call shapes. 0.2.0 is a **non-breaking** upgrade:

- `reply(input)` stays as a deprecated overload with **identical 0.1.x
  behaviour** — it still honours `systemPrompt`, `fallbackReply` and
  `budgetSubKey` from the object.
- `ChatArmorReplyInput` stays exported as a deprecated type.
- The widget posts **both** `clientTraceId` and `sessionId` with the same value.
- Deprecated shapes are removed in **1.0.0**.

**Why not the clean break.** At the time of the decision the package had ~123
downloads in a month, all in the three days after a Hacker News post, with no
daily trickle — i.e. no known dependents. The tempting argument was "break now,
nobody is watching". Rejected: publishing a release that breaks upgraders is a
cost paid by every future adopter who reads the changelog and learns this package
breaks on minor bumps. Correctness of the *upgrade path* is part of the product,
not a courtesy owed only when someone is watching.

**Why the legacy path still honours the sensitive fields.** Silently ignoring
`systemPrompt`/`budgetSubKey` when they arrive via the deprecated object would
turn a compile error into a silent behaviour change — strictly worse, because a
server legitimately passing a grounding prompt would quietly lose it. The old
shape is opt-in and no less safe than 0.1.x already was; the loud one-time
deprecation warning (`LEGACY_REPLY_INPUT_DEPRECATION`) names the exact risk and
the migration, and 1.0.0 removes the shape entirely.

**Cost accepted.** Two ways to call `reply()` until 1.0.0, which is a
consistency smell by any style guide's reckoning. Bounded on
purpose: the removal version is written down here, in the deprecation notice, in
both READMEs and in the CHANGELOG.

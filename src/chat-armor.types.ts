import type { RedisEvalClient } from 'llm-budget-cap';

/**
 * Public contracts for ChatArmor. Kept in a dedicated file (no types declared
 * inside modules/services).
 */

/** Built-in LLM providers. Use `customProvider` to plug in your own. */
export type LlmProviderName = 'gemini' | 'openai';

/**
 * The only thing ChatArmor asks of an LLM: ground the model with a trusted
 * `systemPrompt` and answer an UNTRUSTED `userMessage` delivered in a separate
 * turn. Implement this to support any provider.
 */
export interface LlmProvider {
  /** Human-readable provider name (for logs). */
  readonly name: string;
  /** `true` only when the provider has the credentials it needs to run. */
  isConfigured(): boolean;
  /**
   * Answer `userMessage` grounded on `systemPrompt`. The two MUST stay
   * separated (system vs user turn) — never concatenate the user message into
   * the system prompt. Must enforce its own timeout and throw on any failure;
   * the service maps a throw to the fallback.
   */
  generate(systemPrompt: string, userMessage: string): Promise<string>;
}

/**
 * The heart of the spend cap: wraps `llm-budget-cap`. Bring your own
 * ioredis-compatible client. Omit this whole block to run WITHOUT a spend cap
 * (strongly discouraged in production — a bug or a distributed abuser can blow
 * up your LLM bill).
 */
export interface ChatArmorBudgetOptions {
  /** ioredis-compatible client with an `eval()` method (you bring Redis). */
  readonly redis: RedisEvalClient;
  /** Base counter key, e.g. `chatarmor:landing`. */
  readonly key: string;
  /** Max LLM calls allowed within the window. Must be >= 1. */
  readonly limit: number;
  /** Rolling window in ms. Defaults to 24h. */
  readonly windowMs?: number;
  /**
   * When Redis is unreachable, allow the call through (degraded) instead of
   * throwing. Defaults to `true` — a briefly unmetered feature beats an outage.
   */
  readonly failOpen?: boolean;
  /**
   * Hard timeout in milliseconds for each Redis operation. If Redis does not
   * answer within this budget, the call is decided by `failOpen` instead of
   * hanging. Defaults to 5000. Set to 0 to disable (not recommended).
   */
  readonly timeoutMs?: number;
  /**
   * Optional callback invoked with the underlying error whenever a call
   * degrades to a fail-open result. Use it to alert/meter outages without
   * wrapping every call. Its own throws are swallowed so a broken hook can
   * never break the request path. Only meaningful with `failOpen: true`.
   */
  readonly onDegraded?: (error: unknown) => void;
}

/** Root options for {@link ChatArmorModule.forRoot}. */
export interface ChatArmorModuleOptions {
  /** Which built-in provider to use. Default `'gemini'`. */
  readonly provider?: LlmProviderName;
  /**
   * Provider API key, read server-side ONLY. When absent, ChatArmor is
   * safe-by-default: every call returns the fallback and never hits the LLM.
   */
  readonly apiKey?: string;
  /** Model id. Defaults per provider. */
  readonly model?: string;
  /** Abort the upstream call after this many ms. Default 15000. */
  readonly timeoutMs?: number;
  /** Sampling temperature. Default 0.3. */
  readonly temperature?: number;
  /** Max output tokens. Default 512. */
  readonly maxOutputTokens?: number;
  /** Max accepted user message length (longer is truncated). Default 1000. */
  readonly maxMessageLength?: number;
  /**
   * Anti-prompt-injection guardrail. `true` (default) appends the built-in
   * guardrail to your system prompt; a string uses your own; `false` disables
   * it (the user message is still isolated in its own turn regardless).
   */
  readonly guardrail?: boolean | string;
  /** Default fallback reply. */
  readonly fallbackReply?: string;
  /** Spend cap via llm-budget-cap. Omit to run without a cap (discouraged). */
  readonly budget?: ChatArmorBudgetOptions;
  /** Escape hatch: supply your own provider and ignore `provider`/`apiKey`. */
  readonly customProvider?: LlmProvider;
  /**
   * Register the provider/options globally so `forFeature` in other modules can
   * resolve them. Default `true`.
   */
  readonly global?: boolean;
}

/** Per-bot options for {@link ChatArmorModule.forFeature}. */
export interface ChatArmorFeatureOptions {
  /** Feature name; the instance is injected via `getChatArmorToken(name)`. */
  readonly name: string;
  /** Default system prompt / grounding for this bot (overridable per call). */
  readonly systemPrompt?: string;
  /** Per-bot guardrail override (see {@link ChatArmorModuleOptions.guardrail}). */
  readonly guardrail?: boolean | string;
  /** Per-bot fallback reply override. */
  readonly fallbackReply?: string;
  /** Per-bot spend cap override; inherits the root budget when omitted. */
  readonly budget?: ChatArmorBudgetOptions;
}

/** Async variant for `forRootAsync` (config comes from DI, e.g. ConfigService). */
export interface ChatArmorModuleAsyncOptions {
  readonly imports?: unknown[];
  readonly inject?: unknown[];
  readonly useFactory: (
    ...args: unknown[]
  ) => Promise<ChatArmorModuleOptions> | ChatArmorModuleOptions;
  readonly global?: boolean;
}

/** Why a reply is what it is — useful for logging/metrics on the caller side. */
export type ChatArmorReason =
  | 'ok'
  | 'no-api-key'
  | 'empty-message'
  | 'invalid-input'
  | 'budget-exceeded'
  | 'timeout'
  | 'error';

/**
 * Single-object input accepted by `reply(input)` in 0.1.x.
 *
 * @deprecated Since 0.2.0. Use `reply(message, options)` instead — the untrusted
 * message belongs in its own argument so a request body can't smuggle a
 * `systemPrompt` (prompt-injection by API design) or pick its own spend-cap
 * bucket. This shape still behaves exactly as it did in 0.1.x and will be
 * REMOVED in 1.0.0.
 *
 * Migration: `reply({ message: m, budgetSubKey: k })` → `reply(m, { budgetSubKey: k })`.
 */
export interface ChatArmorReplyInput {
  /** The UNTRUSTED user message. Delivered to the model in its own turn. */
  readonly message: string;
  /** Grounding prompt; falls back to the feature/root default when omitted. */
  readonly systemPrompt?: string;
  /** Per-call fallback override. */
  readonly fallbackReply?: string;
  /**
   * Optional per-tenant / per-user / per-IP suffix for the spend cap, so one
   * budget instance can meter each caller independently
   * (`${key}:${budgetSubKey}`).
   */
  readonly budgetSubKey?: string;
}

/**
 * SERVER-AUTHORITATIVE options for {@link ChatArmorService.reply}. Second
 * argument to `reply(message, options)`.
 *
 * ⚠️ SECURITY: every field here is decided by YOUR server, never by the caller.
 * The untrusted user message is the FIRST, separate argument on purpose — so a
 * request body can't smuggle a `systemPrompt` (prompt-injection by API design)
 * or pick its own spend-cap bucket. NEVER spread a request body into this
 * object: `reply(body.message, { budgetSubKey: user.id })`, not `reply(body)`.
 */
export interface ChatArmorReplyOptions {
  /**
   * Grounding prompt override; falls back to the feature/root default when
   * omitted. SERVER-ONLY — do not source this from the request body.
   */
  readonly systemPrompt?: string;
  /** Per-call fallback override. SERVER-ONLY. */
  readonly fallbackReply?: string;
  /**
   * Per-tenant / per-user / per-IP suffix for the spend cap, so one budget
   * instance can meter each caller independently (`${key}:${budgetSubKey}`).
   *
   * MUST be derived server-side from an authenticated identity (JWT `user.id`,
   * a hashed client IP behind `trust proxy`, a server session) — NEVER from the
   * request body. A client that can choose its own subKey can rotate it to mint
   * a fresh counter per request and evade the cap entirely. Values are
   * sanitized to `[A-Za-z0-9._-]` (max 128 chars); anything else is ignored
   * (the call is metered against the global bucket) and logged.
   */
  readonly budgetSubKey?: string;
}

/**
 * Result of {@link ChatArmorService.reply}. Never throws; always resolves.
 *
 * ⚠️ `reason` and `degraded` are for YOUR server-side logs and metrics — do not
 * forward them to the client. Leaking `reason: 'budget-exceeded'` confirms to an
 * abuser that the cap is drained; `no-api-key` / `degraded` expose internal
 * state. Return only `{ reply }` to the browser.
 */
export interface ChatArmorResult {
  /** The assistant reply, or the fallback text. Render as TEXT, never HTML. */
  readonly reply: string;
  /** `true` when `reply` came from the model; `false` when it is the fallback. */
  readonly ok: boolean;
  /** Why this reply was produced. Server-side only (see the interface note). */
  readonly reason: ChatArmorReason;
  /** `true` when the spend cap ran in degraded (Redis-down, fail-open) mode. */
  readonly degraded?: boolean;
}

import { Logger } from '@nestjs/common';
import type { BudgetCap, BudgetCapDecision } from 'llm-budget-cap';

import {
  DEFAULT_FALLBACK_REPLY,
  DEFAULT_MAX_MESSAGE_LENGTH,
  LEGACY_REPLY_INPUT_DEPRECATION,
} from './chat-armor.constants';
import type {
  ChatArmorReplyInput,
  ChatArmorReplyOptions,
  ChatArmorResult,
  LlmProvider,
} from './chat-armor.types';
import { composeSystemPrompt } from './prompt-guard';

/** Allowed shape for a spend-cap subKey; blocks `:` namespace injection. */
const SUBKEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Validate a server-supplied `budgetSubKey`. Returns the value untouched when it
 * is a safe token, or `undefined` (meter against the global bucket) for anything
 * else — a `:` would let a caller jump budget namespaces, and an unbounded
 * string is a log/DoS vector. Never throws.
 */
function normalizeSubKey(subKey: unknown): string | undefined {
  if (typeof subKey !== 'string') {
    return undefined;
  }
  const trimmed = subKey.trim();
  return SUBKEY_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * Is this the 0.1.x single-object call shape? Only a non-null object carrying a
 * `message` key qualifies; anything else (including a bare string, a number or
 * `null`) flows to the normal path, which rejects it as `invalid-input` without
 * throwing.
 */
function isLegacyReplyInput(value: unknown): value is ChatArmorReplyInput {
  return typeof value === 'object' && value !== null && 'message' in value;
}

/**
 * Verdict of the spend-cap gate. Either the call is stopped before it can cost
 * anything (`cleared: false`, carrying the ready-made rejection), or it may
 * proceed — and `degraded` says whether the cap was actually enforced (`false`)
 * or ran UNMETERED because Redis was unreachable and `failOpen` is on.
 */
type SpendCapVerdict =
  | { readonly cleared: false; readonly rejection: ChatArmorResult }
  | { readonly cleared: true; readonly degraded: boolean };

/** Everything a {@link ChatArmorService} instance needs, resolved from options. */
export interface ResolvedChatArmorConfig {
  readonly guardrail: boolean | string;
  readonly fallbackReply: string;
  readonly maxMessageLength: number;
  readonly defaultSystemPrompt?: string;
}

/**
 * The armored chat facade. One method, `reply()`, that wraps an LLM call with
 * every protection an indie dev tends to forget — extracted from three
 * production chatbots:
 *
 *  1. API key stays server-side (it lives in the provider, never returned).
 *  2. Timeout + total try/catch: the provider aborts a slow call and ANY
 *     failure/timeout degrades to a fixed fallback. **`reply()` never throws.**
 *  3. Anti-prompt-injection: the untrusted user message is delivered to the
 *     model in its OWN turn (never concatenated into the system prompt), and a
 *     guardrail is appended to the grounding.
 *  4. Spend cap: an atomic `llm-budget-cap` counter caps LLM calls per window,
 *     surviving a distributed abuser that a per-IP throttle can't stop.
 *
 * Safe-by-default: with no API key configured, every call returns the fallback
 * and never touches the LLM. Construct instances via the module (`forRoot` /
 * `forFeature`); the plain constructor keeps it trivially unit-testable.
 */
export class ChatArmorService {
  private readonly logger = new Logger(ChatArmorService.name);

  /** Keeps the 0.1.x deprecation notice to one line per instance, not per call. */
  private hasWarnedLegacyReplyInput = false;

  constructor(
    private readonly provider: LlmProvider,
    private readonly config: ResolvedChatArmorConfig,
    private readonly budget: BudgetCap | null,
  ) {}

  /**
   * Answer a single user message. Stateless / single-turn.
   *
   * NEVER throws — this is an enforced invariant, not a hope. `message` is the
   * UNTRUSTED first argument and is normalized defensively: a non-string
   * (number, object, `null`, …) resolves to a well-formed rejection, and the
   * whole body is wrapped so any unexpected failure degrades to the fallback
   * too. On any failure, limit, or missing config it resolves to the fallback
   * reply.
   *
   * @param message The untrusted user message. Delivered to the model in its
   *   OWN turn (never concatenated into the system prompt).
   * @param options SERVER-AUTHORITATIVE overrides (grounding, fallback, spend-cap
   *   subKey). Never pass a request body here — see {@link ChatArmorReplyOptions}.
   */
  async reply(
    message: string,
    options?: ChatArmorReplyOptions,
  ): Promise<ChatArmorResult>;
  /**
   * 0.1.x call shape, kept so an upgrade to 0.2.x compiles and behaves exactly
   * as before. Logs a deprecation notice once per instance.
   *
   * @deprecated Since 0.2.0, removed in 1.0.0. See {@link ChatArmorReplyInput}.
   */
  async reply(input: ChatArmorReplyInput): Promise<ChatArmorResult>;
  async reply(
    messageOrInput: string | ChatArmorReplyInput,
    options: ChatArmorReplyOptions = {},
  ): Promise<ChatArmorResult> {
    if (isLegacyReplyInput(messageOrInput)) {
      if (!this.hasWarnedLegacyReplyInput) {
        this.hasWarnedLegacyReplyInput = true;
        this.logger.warn(LEGACY_REPLY_INPUT_DEPRECATION);
      }
      const { message, ...legacyOptions } = messageOrInput;
      return this.replyToMessage(message, legacyOptions);
    }
    return this.replyToMessage(messageOrInput, options);
  }

  /**
   * The single implementation both call shapes converge on. Split out so the
   * public overload only decides which shape it received — the invariant
   * "never throws" lives here, once.
   */
  private async replyToMessage(
    message: string,
    options: ChatArmorReplyOptions = {},
  ): Promise<ChatArmorResult> {
    // `?? {}` also absorbs a runtime `null` (the default only covers undefined).
    const opts = options ?? {};
    const fallbackReply =
      (typeof opts.fallbackReply === 'string'
        ? opts.fallbackReply
        : undefined) ?? this.config.fallbackReply;

    try {
      // Boundary normalization: the value arrives from an HTTP body, so the
      // `string` type is a compile-time claim only. A non-string is rejected as
      // a value (invalid-input), never as an exception.
      if (typeof message !== 'string') {
        return { reply: fallbackReply, ok: false, reason: 'invalid-input' };
      }
      const trimmed = message.trim();
      if (trimmed === '') {
        return { reply: fallbackReply, ok: false, reason: 'empty-message' };
      }

      if (!this.provider.isConfigured()) {
        return { reply: fallbackReply, ok: false, reason: 'no-api-key' };
      }

      const bounded = trimmed.slice(0, this.config.maxMessageLength);
      const subKey = normalizeSubKey(opts.budgetSubKey);
      if (opts.budgetSubKey !== undefined && subKey === undefined) {
        // A malformed subKey is a server-side wiring bug (this field must come
        // from a trusted identity). Fail SAFE for cost by metering globally, and
        // surface it — without logging the raw value (it may be an IP / PII).
        this.logger.warn(
          'Ignoring a malformed budgetSubKey; metering against the global ' +
            'bucket. It must be a server-derived [A-Za-z0-9._-] token (<=128).',
        );
      }

      const verdict = await this.enforceSpendCap(subKey, fallbackReply);
      if (!verdict.cleared) {
        return verdict.rejection;
      }
      // Only carried when true, so the common result shape stays unchanged.
      const capState = verdict.degraded ? { degraded: true as const } : {};

      const systemPrompt = composeSystemPrompt(
        opts.systemPrompt ?? this.config.defaultSystemPrompt ?? '',
        this.config.guardrail,
      );

      try {
        // The untrusted message is passed as a SEPARATE argument — never merged
        // into `systemPrompt`. This is the core anti-prompt-injection boundary.
        const reply = await this.provider.generate(systemPrompt, bounded);
        return { reply, ok: true, reason: 'ok', ...capState };
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'AbortError';
        this.logger.error(
          `Chat reply failed via ${this.provider.name} (${
            isTimeout ? 'timeout' : 'error'
          }).`,
          error instanceof Error ? error.stack : String(error),
        );
        return {
          reply: fallbackReply,
          ok: false,
          reason: isTimeout ? 'timeout' : 'error',
          ...capState,
        };
      }
    } catch (error) {
      // Belt-and-suspenders: nothing above should throw, but if it ever does,
      // honor the "never throws" contract instead of surfacing a 500.
      this.logger.error(
        'reply() hit an unexpected failure (degraded to fallback).',
        error instanceof Error ? error.stack : String(error),
      );
      return { reply: fallbackReply, ok: false, reason: 'error' };
    }
  }

  /**
   * Charge one unit to the spend cap and decide whether the call may reach the
   * LLM. Runs BEFORE the paid call — that ordering is what makes the cap a real
   * ceiling instead of an after-the-fact tally, so never move it below
   * `provider.generate()`.
   *
   * The counted unit is one LLM call, known up front, so a single atomic
   * `checkAndIncrement` is the right primitive (`reserve`/`settle` exists for
   * costs only knowable AFTER the call, e.g. token counts).
   */
  private async enforceSpendCap(
    subKey: string | undefined,
    fallbackReply: string,
  ): Promise<SpendCapVerdict> {
    if (!this.budget) {
      return { cleared: true, degraded: false };
    }

    let decision: BudgetCapDecision;
    try {
      decision = await this.budget.checkAndIncrement(subKey);
    } catch (error) {
      // Only reachable when the budget is configured `failOpen: false`.
      this.logger.error(
        `Spend cap check failed (failing closed).`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        cleared: false,
        rejection: { reply: fallbackReply, ok: false, reason: 'error' },
      };
    }

    if (!decision.allowed) {
      // Do NOT log the subKey value — it may be an IP or user id (PII).
      this.logger.warn(
        `Spend cap reached (${decision.count}/${decision.limit}) on the ` +
          `${subKey ? 'scoped' : 'global'} bucket; returning fallback.`,
      );
      return {
        cleared: false,
        rejection: {
          reply: fallbackReply,
          ok: false,
          reason: 'budget-exceeded',
          degraded: decision.degraded,
        },
      };
    }

    if (decision.degraded) {
      // Redis is unreachable and `failOpen` let the call through: spending is
      // NOT being capped right now. Loud on purpose — this is the state an
      // operator has to know about, and `result.degraded` carries it to them.
      this.logger.warn(
        'Spend cap is running DEGRADED (Redis unreachable, failing open): ' +
          'this call was NOT metered.',
      );
    }
    return { cleared: true, degraded: decision.degraded };
  }
}

/** Fill option defaults into a {@link ResolvedChatArmorConfig}. */
export function resolveConfig(input: {
  guardrail?: boolean | string;
  fallbackReply?: string;
  maxMessageLength?: number;
  defaultSystemPrompt?: string;
}): ResolvedChatArmorConfig {
  return {
    guardrail: input.guardrail ?? true,
    fallbackReply: input.fallbackReply ?? DEFAULT_FALLBACK_REPLY,
    maxMessageLength: input.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH,
    defaultSystemPrompt: input.defaultSystemPrompt,
  };
}

import { BudgetCap, type RedisEvalClient } from 'llm-budget-cap';

import { buildBudgetCap } from './budget';
import { ChatArmorService, resolveConfig } from './chat-armor.service';
import type { ChatArmorBudgetOptions, LlmProvider } from './chat-armor.types';

const FALLBACK = 'fallback reply';

/** ChatArmor meters one unit per LLM call — the `amount` the Lua script gets. */
const ONE_LLM_CALL = 1;

/** Provider that always answers, and records whether it was reached. */
class ReachProbe implements LlmProvider {
  readonly name = 'fake';
  called = false;
  isConfigured(): boolean {
    return true;
  }
  async generate(): Promise<string> {
    this.called = true;
    return 'the real answer';
  }
}

/** Redis double whose `eval` returns a fixed post-increment count. */
const fakeRedis = (
  count: number | Error,
): RedisEvalClient & {
  eval: jest.Mock;
} => ({
  eval: jest.fn(async () => {
    if (count instanceof Error) {
      throw count;
    }
    return count;
  }),
});

const makeService = (
  redis: RedisEvalClient,
  budgetOverrides: Partial<ChatArmorBudgetOptions> = {},
) => {
  const provider = new ReachProbe();
  const budget = buildBudgetCap({
    redis,
    key: 'chatarmor:test',
    limit: 2,
    ...budgetOverrides,
  });
  const service = new ChatArmorService(
    provider,
    resolveConfig({ fallbackReply: FALLBACK, defaultSystemPrompt: 'ground' }),
    budget,
  );
  return { service, provider, budget };
};

describe('buildBudgetCap', () => {
  it('returns null when no budget is configured (no spend cap)', () => {
    expect(buildBudgetCap(undefined)).toBeNull();
  });

  it('builds a real llm-budget-cap BudgetCap when configured', () => {
    const cap = buildBudgetCap({
      redis: fakeRedis(1),
      key: 'chatarmor:test',
      limit: 5,
    });
    expect(cap).toBeInstanceOf(BudgetCap);
  });

  it('passes timeoutMs through to llm-budget-cap BudgetCap', () => {
    const cap = buildBudgetCap({
      redis: fakeRedis(1),
      key: 'chatarmor:test',
      limit: 5,
      timeoutMs: 3000,
    });
    expect(cap).toBeInstanceOf(BudgetCap);
  });

  it('passes onDegraded callback through to llm-budget-cap BudgetCap', () => {
    const onDegraded = jest.fn();
    const cap = buildBudgetCap({
      redis: fakeRedis(1),
      key: 'chatarmor:test',
      limit: 5,
      onDegraded,
    });
    expect(cap).toBeInstanceOf(BudgetCap);
  });
});

describe('ChatArmorService spend cap integration', () => {
  it('allows the call and reaches the LLM while under the limit', async () => {
    const redis = fakeRedis(1); // count 1 <= limit 2 => allowed
    const { service, provider } = makeService(redis);

    const res = await service.reply('hi');

    expect(res).toEqual({ reply: 'the real answer', ok: true, reason: 'ok' });
    expect(provider.called).toBe(true);
  });

  it('blocks the call and returns the fallback once the limit is exceeded', async () => {
    const redis = fakeRedis(3); // count 3 > limit 2 => blocked
    const { service, provider } = makeService(redis);

    const res = await service.reply('hi');

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('budget-exceeded');
    expect(res.reply).toBe(FALLBACK);
    expect(provider.called).toBe(false);
  });

  it('scopes the counter by a server-side budgetSubKey (per-user / per-tenant / per-IP)', async () => {
    const redis = fakeRedis(1);
    const { service } = makeService(redis);

    await service.reply('hi', { budgetSubKey: 'user-42' });

    // Lua script gets KEYS[1] = `${key}:${subKey}`, ARGV = [windowMs, amount].
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'chatarmor:test:user-42',
      expect.any(Number),
      ONE_LLM_CALL,
    );
  });

  it('ignores a subKey with a ":" (namespace-injection) and meters globally', async () => {
    const redis = fakeRedis(1);
    const { service } = makeService(redis);

    // A `:` would let a caller jump budget namespaces (`chatarmor:account`).
    await service.reply('hi', { budgetSubKey: 'landing:account' });

    // The malformed subKey is dropped: the counter is the base key, not scoped.
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'chatarmor:test',
      expect.any(Number),
      ONE_LLM_CALL,
    );
  });

  it('ignores an over-long subKey (>128 chars) and meters globally', async () => {
    const redis = fakeRedis(1);
    const { service } = makeService(redis);

    await service.reply('hi', { budgetSubKey: 'a'.repeat(200) });

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'chatarmor:test',
      expect.any(Number),
      ONE_LLM_CALL,
    );
  });

  it('fails OPEN by default: a Redis outage still lets the assistant answer', async () => {
    const redis = fakeRedis(new Error('redis down'));
    const { service, provider } = makeService(redis); // failOpen defaults to true

    const res = await service.reply('hi');

    expect(res.ok).toBe(true);
    expect(provider.called).toBe(true);
  });

  it('fails CLOSED when configured: a Redis outage degrades to the fallback', async () => {
    const redis = fakeRedis(new Error('redis down'));
    const { service, provider } = makeService(redis, { failOpen: false });

    const res = await service.reply('hi');

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('error');
    expect(res.reply).toBe(FALLBACK);
    expect(provider.called).toBe(false);
  });

  it('reports degraded on a SUCCESSFUL reply when the cap ran unmetered', async () => {
    const redis = fakeRedis(new Error('redis down'));
    const { service, provider } = makeService(redis); // failOpen defaults to true

    const res = await service.reply('hi');

    // The assistant answered, but nothing was counted: the operator has to be
    // able to see that spending is currently uncapped.
    expect(res).toEqual({
      reply: 'the real answer',
      ok: true,
      reason: 'ok',
      degraded: true,
    });
    expect(provider.called).toBe(true);
  });

  it('omits degraded entirely when the cap really metered the call', async () => {
    const redis = fakeRedis(1);
    const { service } = makeService(redis);

    const res = await service.reply('hi');

    expect(res.degraded).toBeUndefined();
  });
});

/**
 * The cap has to hold when many requests land at once — the failure mode that
 * motivated llm-budget-cap 0.2.0, where the counter was only charged AFTER the
 * paid call and concurrent traffic blew ~20x past the limit.
 *
 * ChatArmor charges the counter BEFORE `provider.generate()`, so the bound is on
 * calls that actually reach the LLM, not on calls that merely finished.
 */
describe('ChatArmorService spend cap under concurrency', () => {
  /**
   * Redis double that really counts: it applies the same `INCRBY` semantics the
   * Lua script does and yields to the microtask queue first, so concurrent
   * callers genuinely interleave instead of running to completion one by one.
   */
  class CountingRedis implements RedisEvalClient {
    private readonly counters = new Map<string, number>();

    async eval(
      _script: string,
      _numKeys: number,
      ...args: (string | number)[]
    ): Promise<number> {
      const [key, , amount] = args as [string, number, number];
      await Promise.resolve(); // let every concurrent caller reach this point
      const next = (this.counters.get(key) ?? 0) + Number(amount);
      this.counters.set(key, next);
      return next;
    }
  }

  /** Provider that counts how many times the paid LLM call was actually made. */
  class PaidCallCounter implements LlmProvider {
    readonly name = 'fake';
    paidCalls = 0;
    isConfigured(): boolean {
      return true;
    }
    async generate(): Promise<string> {
      this.paidCalls += 1;
      await Promise.resolve();
      return 'the real answer';
    }
  }

  const LIMIT = 5;
  const CONCURRENT_REQUESTS = 50;

  it('never lets more than `limit` calls reach the LLM, however many arrive at once', async () => {
    const provider = new PaidCallCounter();
    const service = new ChatArmorService(
      provider,
      resolveConfig({ fallbackReply: FALLBACK }),
      buildBudgetCap({
        redis: new CountingRedis(),
        key: 'chatarmor:test',
        limit: LIMIT,
      }),
    );

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () => service.reply('hi')),
    );

    expect(provider.paidCalls).toBe(LIMIT);
    expect(results.filter((res) => res.ok)).toHaveLength(LIMIT);
    expect(
      results.filter((res) => res.reason === 'budget-exceeded'),
    ).toHaveLength(CONCURRENT_REQUESTS - LIMIT);
  });

  it('caps each budgetSubKey independently without leaking budget between them', async () => {
    const provider = new PaidCallCounter();
    const service = new ChatArmorService(
      provider,
      resolveConfig({ fallbackReply: FALLBACK }),
      buildBudgetCap({
        redis: new CountingRedis(),
        key: 'chatarmor:test',
        limit: LIMIT,
      }),
    );
    const tenants = ['tenant-a', 'tenant-b'];

    const results = await Promise.all(
      tenants.flatMap((budgetSubKey) =>
        Array.from({ length: CONCURRENT_REQUESTS }, () =>
          service.reply('hi', { budgetSubKey }),
        ),
      ),
    );

    // Each tenant gets its own ceiling: one abuser cannot drain the other.
    expect(provider.paidCalls).toBe(LIMIT * tenants.length);
    expect(results.filter((res) => res.ok)).toHaveLength(
      LIMIT * tenants.length,
    );
  });
});

/**
 * llm-budget-cap 0.2.0 THROWS on a subKey it considers malformed, where 0.1.0
 * accepted anything. ChatArmor normalizes first, so the two validators must stay
 * compatible — if they ever drift, a legitimate subKey would turn into a thrown
 * BudgetCapError and silently degrade every scoped call to `reason: 'error'`.
 */
describe('budgetSubKey normalization vs llm-budget-cap validation', () => {
  const acceptedSubKeys = [
    'user-42',
    'tenant_9',
    'a.b.c',
    'UPPER-and-lower-123',
    'a'.repeat(128), // exactly at the shared 128-char ceiling
  ];

  it.each(acceptedSubKeys)(
    'meters "%s" against its own scoped bucket instead of erroring',
    async (subKey) => {
      const redis = fakeRedis(1);
      const { service } = makeService(redis);

      const res = await service.reply('hi', { budgetSubKey: subKey });

      expect(res.reason).toBe('ok');
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        `chatarmor:test:${subKey}`,
        expect.any(Number),
        ONE_LLM_CALL,
      );
    },
  );

  it('never forwards an empty subKey, which 0.2.0 rejects outright', async () => {
    const redis = fakeRedis(1);
    const { service } = makeService(redis);

    const res = await service.reply('hi', { budgetSubKey: '' });

    // Normalized away to the global bucket — NOT passed through as `''`.
    expect(res.reason).toBe('ok');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'chatarmor:test',
      expect.any(Number),
      ONE_LLM_CALL,
    );
  });
});

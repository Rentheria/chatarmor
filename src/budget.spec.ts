import { BudgetCap, type RedisEvalClient } from 'llm-budget-cap';

import { buildBudgetCap } from './budget';
import { ChatArmorService, resolveConfig } from './chat-armor.service';
import type { ChatArmorBudgetOptions, LlmProvider } from './chat-armor.types';

const FALLBACK = 'fallback reply';

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

    // Lua script gets KEYS[1] = `${key}:${subKey}`.
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'chatarmor:test:user-42',
      expect.any(Number),
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
});

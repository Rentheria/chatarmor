import { BudgetCap } from 'llm-budget-cap';

import type { ChatArmorBudgetOptions } from './chat-armor.types';

/**
 * Build a {@link BudgetCap} from ChatArmor's budget options, or `null` when no
 * budget is configured. This is the real spend cap — the sibling package
 * `llm-budget-cap` — wired as a first-class dependency, not an afterthought.
 *
 * Returning `null` (no cap) is allowed but strongly discouraged in production:
 * without it, a bug or a distributed abuser can run your LLM bill up while you
 * sleep. When present, `failOpen` defaults to `true` (a briefly unmetered
 * feature during a Redis outage beats taking the assistant down).
 */
export function buildBudgetCap(
  options: ChatArmorBudgetOptions | undefined,
): BudgetCap | null {
  if (!options) {
    return null;
  }
  return new BudgetCap({
    redis: options.redis,
    key: options.key,
    limit: options.limit,
    windowMs: options.windowMs,
    failOpen: options.failOpen ?? true,
  });
}

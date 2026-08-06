import { DEFAULT_GUARDRAIL } from './chat-armor.constants';
import { composeSystemPrompt } from './prompt-guard';

describe('composeSystemPrompt', () => {
  it('appends the built-in guardrail when guardrail is true', () => {
    const result = composeSystemPrompt('Ground truth.', true);

    expect(result).toContain('Ground truth.');
    expect(result).toContain(DEFAULT_GUARDRAIL);
  });

  it('appends a custom guardrail string when provided', () => {
    const result = composeSystemPrompt('Ground truth.', 'MY CUSTOM RULE');

    expect(result).toBe('Ground truth.\n\nMY CUSTOM RULE');
    expect(result).not.toContain(DEFAULT_GUARDRAIL);
  });

  it('returns the system prompt unchanged when guardrail is false', () => {
    const result = composeSystemPrompt('Ground truth.', false);

    expect(result).toBe('Ground truth.');
  });
});

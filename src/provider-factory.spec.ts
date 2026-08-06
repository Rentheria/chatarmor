import { createProvider } from './provider-factory';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';
import type { LlmProvider } from './chat-armor.types';

describe('createProvider', () => {
  it('builds a Gemini provider by default', () => {
    const provider = createProvider({ apiKey: 'k' });

    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe('gemini');
    expect(provider.isConfigured()).toBe(true);
  });

  it('builds an OpenAI provider when provider is "openai"', () => {
    const provider = createProvider({ provider: 'openai', apiKey: 'k' });

    expect(provider).toBeInstanceOf(OpenAiProvider);
    expect(provider.name).toBe('openai');
  });

  it('reports not configured when no API key is given (safe-by-default)', () => {
    const provider = createProvider({});

    expect(provider.isConfigured()).toBe(false);
  });

  it('returns the custom provider verbatim when supplied', () => {
    const custom: LlmProvider = {
      name: 'custom',
      isConfigured: () => true,
      generate: async () => 'x',
    };

    expect(createProvider({ customProvider: custom })).toBe(custom);
  });
});

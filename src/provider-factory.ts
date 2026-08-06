import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
} from './chat-armor.constants';
import type { ChatArmorModuleOptions, LlmProvider } from './chat-armor.types';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';

/**
 * Resolve the concrete {@link LlmProvider} from the module options. A
 * `customProvider` wins; otherwise we build the requested built-in provider
 * (Gemini by default) with defaults filled in. Kept out of the module file so
 * both `forRoot` and `forRootAsync` share one resolution path.
 */
export function createProvider(options: ChatArmorModuleOptions): LlmProvider {
  if (options.customProvider) {
    return options.customProvider;
  }

  const shared = {
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };

  if (options.provider === 'openai') {
    return new OpenAiProvider({
      ...shared,
      model: options.model ?? DEFAULT_OPENAI_MODEL,
    });
  }

  return new GeminiProvider({
    ...shared,
    model: options.model ?? DEFAULT_GEMINI_MODEL,
  });
}

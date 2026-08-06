import {
  OPENAI_API_URL,
  UPSTREAM_DETAIL_MAX_LENGTH,
} from '../chat-armor.constants';
import type { LlmProvider } from '../chat-armor.types';

/**
 * Bound the upstream response body embedded in a thrown error so a chatty vendor
 * error can't flood the server logs (the caller logs `error.stack`).
 */
const truncate = (detail: string): string =>
  detail.length > UPSTREAM_DETAIL_MAX_LENGTH
    ? `${detail.slice(0, UPSTREAM_DETAIL_MAX_LENGTH)}…(truncated)`
    : detail;

/** Minimal shape of the OpenAI Chat Completions response we rely on. */
interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** Config the {@link OpenAiProvider} needs, resolved from the module options. */
export interface OpenAiProviderConfig {
  readonly apiKey?: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxOutputTokens: number;
}

/**
 * OpenAI Chat Completions transport — the same shape as {@link GeminiProvider},
 * so the provider is swappable without touching the rest of ChatArmor.
 *
 * The key is read server-side ONLY and sent as a Bearer header (never the URL).
 * ANTI-PROMPT-INJECTION: the grounding goes in the `system` message and the
 * untrusted `userMessage` in a separate `user` message — never concatenated.
 * Hard `AbortController` timeout; throws on any non-2xx or empty choice so the
 * caller can fall back.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';

  constructor(private readonly config: OpenAiProviderConfig) {}

  isConfigured(): boolean {
    const { apiKey } = this.config;
    return typeof apiKey === 'string' && apiKey.length > 0;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const { apiKey, model, timeoutMs, temperature, maxOutputTokens } =
      this.config;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error('OpenAI API key is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxOutputTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      });

      if (!response.ok) {
        const detail = truncate(await response.text().catch(() => ''));
        throw new Error(`OpenAI responded ${response.status}: ${detail}`);
      }

      const data = (await response.json()) as OpenAiResponse;
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      if (text === '') {
        throw new Error('OpenAI returned an empty choice.');
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}

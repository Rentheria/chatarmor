import {
  GEMINI_API_BASE,
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

/** Minimal shape of the Gemini `generateContent` REST response we rely on. */
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
}

/** Config the {@link GeminiProvider} needs, resolved from the module options. */
export interface GeminiProviderConfig {
  readonly apiKey?: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxOutputTokens: number;
}

/**
 * Gemini transport — proven verbatim across three production chatbots.
 *
 * One HTTPS POST to the Generative Language REST API via the global `fetch` (no
 * SDK). The API key travels in a header (never the URL/querystring, so it can't
 * leak into proxy/access logs) and is read server-side ONLY — it never reaches
 * the frontend.
 *
 * ANTI-PROMPT-INJECTION: the untrusted `userMessage` is sent in the `user`
 * role, isolated from the grounding `system_instruction`. Bounded by a hard
 * `AbortController` timeout. Throws on any non-2xx, safety block, or empty
 * candidate — the raw upstream error stays server-side; the caller maps a throw
 * to the friendly fallback.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(private readonly config: GeminiProviderConfig) {}

  isConfigured(): boolean {
    const { apiKey } = this.config;
    return typeof apiKey === 'string' && apiKey.length > 0;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const { apiKey, model, timeoutMs, temperature, maxOutputTokens } =
      this.config;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error('Gemini API key is not configured.');
    }

    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { temperature, maxOutputTokens },
        }),
      });

      if (!response.ok) {
        const detail = truncate(await response.text().catch(() => ''));
        throw new Error(`Gemini responded ${response.status}: ${detail}`);
      }

      const data = (await response.json()) as GeminiResponse;
      const blockReason = data.promptFeedback?.blockReason;
      if (blockReason !== undefined) {
        throw new Error(`Gemini blocked the prompt: ${blockReason}`);
      }

      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();
      if (text === '') {
        throw new Error('Gemini returned an empty candidate.');
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}

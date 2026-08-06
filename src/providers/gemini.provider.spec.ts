import { GeminiProvider } from './gemini.provider';

const baseConfig = {
  apiKey: 'secret-key',
  model: 'gemini-2.5-flash',
  timeoutMs: 5000,
  temperature: 0.3,
  maxOutputTokens: 512,
};

const okResponse = (text: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  }) as unknown as Response;

describe('GeminiProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws (never runs) when no API key is configured', async () => {
    const provider = new GeminiProvider({ ...baseConfig, apiKey: undefined });

    await expect(provider.generate('sys', 'hi')).rejects.toThrow(
      /not configured/,
    );
  });

  it('sends the key in a header (never the URL) and isolates the user turn', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse('grounded answer'));
    const provider = new GeminiProvider(baseConfig);

    const reply = await provider.generate('SYSTEM GROUNDING', 'user question');

    expect(reply).toBe('grounded answer');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    // Key travels in a header, not the querystring/URL.
    expect(url).not.toContain('secret-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'secret-key',
    );

    // ANTI-PROMPT-INJECTION at the wire: system_instruction and the user turn
    // are separate fields; the user text is NEVER in system_instruction.
    const body = JSON.parse(init.body as string);
    expect(body.system_instruction.parts[0].text).toBe('SYSTEM GROUNDING');
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('user question');
    expect(JSON.stringify(body.system_instruction)).not.toContain(
      'user question',
    );
  });

  it('throws on a non-2xx response (caller maps it to the fallback)', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as unknown as Response);
    const provider = new GeminiProvider(baseConfig);

    await expect(provider.generate('sys', 'hi')).rejects.toThrow(/429/);
  });

  it('throws when the model returns an empty candidate', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse(''));
    const provider = new GeminiProvider(baseConfig);

    await expect(provider.generate('sys', 'hi')).rejects.toThrow(/empty/);
  });

  it('throws on a safety block', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    } as unknown as Response);
    const provider = new GeminiProvider(baseConfig);

    await expect(provider.generate('sys', 'hi')).rejects.toThrow(/blocked/);
  });
});

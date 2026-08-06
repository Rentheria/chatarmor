import { OpenAiProvider } from './openai.provider';

const baseConfig = {
  apiKey: 'secret-key',
  model: 'gpt-4o-mini',
  timeoutMs: 5000,
  temperature: 0.3,
  maxOutputTokens: 512,
};

const okResponse = (content: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }) as unknown as Response;

describe('OpenAiProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws (never runs) when no API key is configured', async () => {
    const provider = new OpenAiProvider({ ...baseConfig, apiKey: undefined });

    await expect(provider.generate('sys', 'hi')).rejects.toThrow(
      /not configured/,
    );
  });

  it('sends a Bearer key and isolates the system message from the user message', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse('the answer'));
    const provider = new OpenAiProvider(baseConfig);

    const reply = await provider.generate('SYSTEM GROUNDING', 'user question');

    expect(reply).toBe('the answer');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).not.toContain('secret-key');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-key',
    );

    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'SYSTEM GROUNDING',
    });
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'user question',
    });
  });

  it('throws on a non-2xx response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    } as unknown as Response);
    const provider = new OpenAiProvider(baseConfig);

    await expect(provider.generate('sys', 'hi')).rejects.toThrow(/500/);
  });

  it('throws when the model returns an empty choice', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse(''));
    const provider = new OpenAiProvider(baseConfig);

    await expect(provider.generate('sys', 'hi')).rejects.toThrow(/empty/);
  });
});

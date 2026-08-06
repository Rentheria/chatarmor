import { Test } from '@nestjs/testing';

import { getChatArmorToken } from './chat-armor.constants';
import { ChatArmorModule } from './chat-armor.module';
import { ChatArmorService } from './chat-armor.service';

describe('ChatArmorModule wiring', () => {
  it('forRoot provides a working default ChatArmorService (safe-by-default, no key)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ChatArmorModule.forRoot({
          provider: 'gemini',
          fallbackReply: 'root fallback',
        }),
      ],
    }).compile();

    const service = moduleRef.get(ChatArmorService);
    const res = await service.reply('hi', { systemPrompt: 'ground' });

    // No API key configured => safe fallback, never hits the network.
    expect(res).toEqual({
      reply: 'root fallback',
      ok: false,
      reason: 'no-api-key',
    });

    await moduleRef.close();
  });

  it('forFeature registers a named instance injectable by its token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ChatArmorModule.forRoot({ provider: 'gemini' }),
        ChatArmorModule.forFeature({
          name: 'landing',
          systemPrompt: 'You are the landing assistant.',
          fallbackReply: 'landing fallback',
        }),
      ],
    }).compile();

    const landing = moduleRef.get<ChatArmorService>(
      getChatArmorToken('landing'),
    );

    expect(landing).toBeInstanceOf(ChatArmorService);
    const res = await landing.reply('hola');
    expect(res.reply).toBe('landing fallback');

    await moduleRef.close();
  });

  it('forRootAsync resolves options from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ChatArmorModule.forRootAsync({
          useFactory: () => ({
            provider: 'openai',
            fallbackReply: 'async fallback',
          }),
        }),
      ],
    }).compile();

    const service = moduleRef.get(ChatArmorService);
    const res = await service.reply('hi', { systemPrompt: 'g' });
    expect(res.reply).toBe('async fallback');

    await moduleRef.close();
  });
});

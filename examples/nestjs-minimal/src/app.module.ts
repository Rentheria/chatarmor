import { Module } from '@nestjs/common';
import { ChatArmorModule } from 'chatarmor';
import Redis from 'ioredis';
import { ChatController } from './chat.controller';

@Module({
  imports: [
    ChatArmorModule.forRoot({
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY,
      budget: {
        redis: new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
          enableOfflineQueue: false, // fail-fast: dead Redis errors instead of queueing
          maxRetriesPerRequest: 2, // don't hang the request path on a retry storm
        }),
        key: 'chatarmor:example',
        limit: 500, // 500 calls/24h
      },
    }),
  ],
  controllers: [ChatController],
})
export class AppModule {}

import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ChatArmorService } from 'chatarmor';
import { ChatDto } from './chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatArmorService) {}

  @Post()
  @HttpCode(200)
  async ask(@Body() body: ChatDto) {
    const result = await this.chat.reply(body.message, {
      systemPrompt: 'You are a helpful assistant.',
    });
    return { reply: result.reply };
  }
}

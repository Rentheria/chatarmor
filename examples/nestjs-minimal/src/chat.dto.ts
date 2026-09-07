import { IsString, Length } from 'class-validator';

export class ChatDto {
  @IsString()
  @Length(1, 1000)
  message!: string;
}

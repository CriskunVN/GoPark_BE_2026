import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MessageType } from '../entities/message.entity';

export class SendMessageDto {
  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsString()
  @IsNotEmpty()
  receiverId: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsEnum(MessageType)
  @IsOptional()
  type?: MessageType;

  @IsString()
  @IsOptional()
  fileUrl?: string;

  @IsString()
  @IsOptional()
  fileName?: string;
}

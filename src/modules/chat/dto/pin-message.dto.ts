import { IsOptional, IsString } from 'class-validator';

export class PinMessageDto {
  @IsOptional()
  @IsString()
  messageId?: string | null;
}

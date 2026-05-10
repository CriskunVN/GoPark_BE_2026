import { IsNotEmpty, IsString } from 'class-validator';

export class InitConversationDto {
  @IsString()
  @IsNotEmpty()
  receiverId: string;
}
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { CreateNotificationDto } from './create-notification.dto';

export class SendNotificationToUsersDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  userIds: string[];

  @ValidateNested()
  @Type(() => CreateNotificationDto)
  notification: CreateNotificationDto;
}

export class SendNotificationToRolesDto {
  @ValidateNested()
  @Type(() => CreateNotificationDto)
  notification: CreateNotificationDto;
}

export class BroadcastNotificationDto {
  @ValidateNested()
  @Type(() => CreateNotificationDto)
  notification: CreateNotificationDto;
}

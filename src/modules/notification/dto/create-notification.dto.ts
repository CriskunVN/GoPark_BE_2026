export class CreateNotificationDto {
  title: string;
  content: string;
  target_role: string;
  type: string;
}

export class CreateNotificationRecipientDto {
  notificationId: string;
  userIds: string[];
}
